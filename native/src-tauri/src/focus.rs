use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;

use crate::protocol::{SelectionSnapshot, SourceWindowIdentity};

const FOREGROUND_POLL_INTERVAL: Duration = Duration::from_millis(50);
const SOURCE_IDENTITY_MAX_AGE: Duration = Duration::from_secs(5 * 60);
const MAX_REMEMBERED_SOURCES: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SnapshotKey {
    snapshot_id: String,
    revision: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WindowTarget {
    process_id: u32,
    window_handle: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ForegroundObservation {
    Internal,
    External(WindowTarget),
    Unavailable,
}

#[derive(Debug, Default)]
struct FocusState {
    epoch: u64,
    current_external: Option<WindowTarget>,
    initialized: bool,
    shutting_down: bool,
    sources: HashMap<SnapshotKey, SourceWindowIdentity>,
    source_order: VecDeque<SnapshotKey>,
}

impl FocusState {
    fn observe(&mut self, observation: ForegroundObservation) {
        let next = match observation {
            ForegroundObservation::Internal => return,
            ForegroundObservation::External(target) => Some(target),
            ForegroundObservation::Unavailable => None,
        };
        if !self.initialized {
            self.current_external = next;
            self.initialized = true;
            return;
        }
        if self.current_external != next {
            self.current_external = next;
            self.epoch = self.epoch.wrapping_add(1);
        }
    }

    fn remember(&mut self, key: SnapshotKey, identity: SourceWindowIdentity) {
        if !self.sources.contains_key(&key) {
            self.source_order.push_back(key.clone());
        }
        self.sources.insert(key, identity);
        while self.source_order.len() > MAX_REMEMBERED_SOURCES {
            if let Some(expired) = self.source_order.pop_front() {
                self.sources.remove(&expired);
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FocusRestoreReason {
    Restored,
    NoSourceIdentity,
    SourceExpired,
    UserChangedFocus,
    SourceWindowUnavailable,
    SourceProcessUnavailable,
    ProcessMismatch,
    WindowTitleChanged,
    WindowMinimized,
    FocusDenied,
    ShuttingDown,
    UnsupportedPlatform,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusRestoreResult {
    pub restored: bool,
    pub reason: FocusRestoreReason,
}

impl FocusRestoreResult {
    fn with_reason(reason: FocusRestoreReason) -> Self {
        Self {
            restored: reason == FocusRestoreReason::Restored,
            reason,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct FocusRuntime {
    state: Arc<Mutex<FocusState>>,
    stop: Arc<AtomicBool>,
}

impl FocusRuntime {
    pub fn start() -> Result<Self, String> {
        let runtime = Self::default();
        #[cfg(windows)]
        {
            runtime.observe_os_foreground();
            let tracker = runtime.clone();
            thread::Builder::new()
                .name("dsh-focus-epoch-tracker".to_owned())
                .spawn(move || {
                    while !tracker.stop.load(Ordering::Acquire) {
                        tracker.observe_os_foreground();
                        thread::sleep(FOREGROUND_POLL_INTERVAL);
                    }
                })
                .map_err(|error| format!("failed to start source focus tracker: {error}"))?;
        }
        Ok(runtime)
    }

    /// Attach a trusted identity only when the provider's source is still the
    /// external foreground window. Background stale selections fail closed.
    pub fn bind_snapshot(&self, snapshot: &mut SelectionSnapshot) -> bool {
        let Some(identity) = snapshot.source_window_identity.as_mut() else {
            return true;
        };
        let Some(handle) = parse_window_handle(&identity.window_handle) else {
            snapshot.source_window_identity = None;
            return true;
        };

        self.observe_os_foreground();
        let mut state = self.state.lock().expect("focus state poisoned");
        if state.shutting_down {
            return false;
        }
        let target = WindowTarget {
            process_id: identity.process_id,
            window_handle: handle,
        };
        if state.current_external != Some(target) {
            return false;
        }

        identity.captured_at = now_millis();
        identity.focus_epoch = state.epoch;
        let key = SnapshotKey {
            snapshot_id: snapshot.id.clone(),
            revision: snapshot.revision,
        };
        state.remember(key, identity.clone());
        true
    }

    pub fn shutdown(&self) {
        self.stop.store(true, Ordering::Release);
        self.state
            .lock()
            .expect("focus state poisoned")
            .shutting_down = true;
    }

    fn observe_os_foreground(&self) {
        #[cfg(windows)]
        {
            let observation = read_foreground_observation(std::process::id());
            self.state
                .lock()
                .expect("focus state poisoned")
                .observe(observation);
        }
    }

    fn restore(&self, snapshot_id: &str, revision: u64) -> FocusRestoreResult {
        #[cfg(not(windows))]
        {
            let _ = (snapshot_id, revision);
            return FocusRestoreResult::with_reason(FocusRestoreReason::UnsupportedPlatform);
        }

        #[cfg(windows)]
        {
            self.observe_os_foreground();
            let key = SnapshotKey {
                snapshot_id: snapshot_id.to_owned(),
                revision,
            };
            let (identity, current_external, epoch, shutting_down) = {
                let state = self.state.lock().expect("focus state poisoned");
                (
                    state.sources.get(&key).cloned(),
                    state.current_external,
                    state.epoch,
                    state.shutting_down,
                )
            };
            if shutting_down {
                return FocusRestoreResult::with_reason(FocusRestoreReason::ShuttingDown);
            }
            let Some(identity) = identity else {
                return FocusRestoreResult::with_reason(FocusRestoreReason::NoSourceIdentity);
            };
            let Some(handle) = parse_window_handle(&identity.window_handle) else {
                return FocusRestoreResult::with_reason(
                    FocusRestoreReason::SourceWindowUnavailable,
                );
            };
            let target = WindowTarget {
                process_id: identity.process_id,
                window_handle: handle,
            };
            match restore_decision(&identity, current_external, epoch, now_millis()) {
                Ok(()) => {}
                Err(reason) => return FocusRestoreResult::with_reason(reason),
            }
            if let Err(reason) = validate_windows_identity(target, &identity) {
                return FocusRestoreResult::with_reason(reason);
            }

            // Recheck immediately before requesting focus. The OS foreground
            // lock remains the final barrier if the user switches at this instant.
            self.observe_os_foreground();
            let (current_external, epoch, shutting_down) = {
                let state = self.state.lock().expect("focus state poisoned");
                (state.current_external, state.epoch, state.shutting_down)
            };
            if shutting_down {
                return FocusRestoreResult::with_reason(FocusRestoreReason::ShuttingDown);
            }
            if let Err(reason) = restore_decision(&identity, current_external, epoch, now_millis())
            {
                return FocusRestoreResult::with_reason(reason);
            }
            match set_windows_foreground(target) {
                Ok(()) => FocusRestoreResult::with_reason(FocusRestoreReason::Restored),
                Err(reason) => FocusRestoreResult::with_reason(reason),
            }
        }
    }
}

fn restore_decision(
    identity: &SourceWindowIdentity,
    current_external: Option<WindowTarget>,
    current_epoch: u64,
    now: u64,
) -> Result<(), FocusRestoreReason> {
    if identity.captured_at > now
        || now.saturating_sub(identity.captured_at) > SOURCE_IDENTITY_MAX_AGE.as_millis() as u64
    {
        return Err(FocusRestoreReason::SourceExpired);
    }
    if current_epoch != identity.focus_epoch || current_external != target_for(identity) {
        return Err(FocusRestoreReason::UserChangedFocus);
    }
    Ok(())
}

fn target_for(identity: &SourceWindowIdentity) -> Option<WindowTarget> {
    Some(WindowTarget {
        process_id: identity.process_id,
        window_handle: parse_window_handle(&identity.window_handle)?,
    })
}

fn parse_window_handle(value: &str) -> Option<usize> {
    let handle = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))?;
    usize::from_str_radix(handle, 16)
        .ok()
        .filter(|handle| *handle != 0)
}

#[cfg(windows)]
fn read_foreground_observation(own_process_id: u32) -> ForegroundObservation {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    let handle = unsafe { GetForegroundWindow() };
    if handle.is_null() {
        return ForegroundObservation::Unavailable;
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(handle, &mut process_id) };
    if process_id == own_process_id {
        return ForegroundObservation::Internal;
    }
    if process_id == 0 {
        return ForegroundObservation::Unavailable;
    }
    ForegroundObservation::External(WindowTarget {
        process_id,
        window_handle: handle as usize,
    })
}

#[cfg(windows)]
fn validate_windows_identity(
    target: WindowTarget,
    identity: &SourceWindowIdentity,
) -> Result<(), FocusRestoreReason> {
    use windows_sys::Win32::Foundation::{CloseHandle, HWND};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
    };

    let hwnd = target.window_handle as HWND;
    if unsafe { IsWindow(hwnd) } == 0 || unsafe { IsWindowVisible(hwnd) } == 0 {
        return Err(FocusRestoreReason::SourceWindowUnavailable);
    }
    if unsafe { IsIconic(hwnd) } != 0 {
        return Err(FocusRestoreReason::WindowMinimized);
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) };
    if process_id != identity.process_id {
        return Err(FocusRestoreReason::ProcessMismatch);
    }

    if let Some(expected_name) = identity.process_name.as_deref() {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
        if process.is_null() {
            return Err(FocusRestoreReason::SourceProcessUnavailable);
        }
        let mut path = vec![0u16; 32_768];
        let mut length = path.len() as u32;
        let read =
            unsafe { QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut length) };
        unsafe { CloseHandle(process) };
        if read == 0 {
            return Err(FocusRestoreReason::SourceProcessUnavailable);
        }
        let image_path = String::from_utf16_lossy(&path[..length as usize]);
        let actual_name = image_path.rsplit(['\\', '/']).next().unwrap_or_default();
        if !actual_name.eq_ignore_ascii_case(expected_name) {
            return Err(FocusRestoreReason::ProcessMismatch);
        }
    }

    if let Some(expected_title) = identity.window_title.as_deref() {
        let mut title = vec![0u16; 2_048];
        let length = unsafe { GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32) };
        let actual_title = String::from_utf16_lossy(&title[..length.max(0) as usize]);
        if normalize_title(&actual_title) != normalize_title(expected_title) {
            return Err(FocusRestoreReason::WindowTitleChanged);
        }
    }

    Ok(())
}

#[cfg(windows)]
fn set_windows_foreground(target: WindowTarget) -> Result<(), FocusRestoreReason> {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

    if unsafe { SetForegroundWindow(target.window_handle as HWND) } == 0 {
        return Err(FocusRestoreReason::FocusDenied);
    }
    Ok(())
}

fn normalize_title(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub fn restore_source_focus(
    focus: State<'_, FocusRuntime>,
    snapshot_id: String,
    revision: u64,
) -> FocusRestoreResult {
    focus.restore(&snapshot_id, revision)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(captured_at: u64, focus_epoch: u64) -> SourceWindowIdentity {
        SourceWindowIdentity {
            process_id: 1200,
            window_handle: "0xA001".to_owned(),
            process_name: Some("chrome.exe".to_owned()),
            window_title: Some("Article - Google Chrome".to_owned()),
            captured_at,
            focus_epoch,
        }
    }

    fn target(process_id: u32, window_handle: usize) -> WindowTarget {
        WindowTarget {
            process_id,
            window_handle,
        }
    }

    #[test]
    fn focus_epoch_tracks_external_task_switches_but_ignores_lens_focus() {
        let chrome = target(1200, 0xa001);
        let editor = target(4300, 0xb002);
        let mut state = FocusState::default();
        state.observe(ForegroundObservation::External(chrome));
        assert_eq!(state.epoch, 0);
        state.observe(ForegroundObservation::Internal);
        assert_eq!(state.current_external, Some(chrome));
        state.observe(ForegroundObservation::External(editor));
        assert_eq!(state.epoch, 1);
        state.observe(ForegroundObservation::External(chrome));
        assert_eq!(state.epoch, 2);
    }

    #[test]
    fn restore_requires_the_same_window_process_and_focus_epoch() {
        let source = identity(10_000, 4);
        assert_eq!(
            restore_decision(&source, Some(target(1200, 0xa001)), 4, 11_000),
            Ok(())
        );
        assert_eq!(
            restore_decision(&source, Some(target(4300, 0xa001)), 4, 11_000),
            Err(FocusRestoreReason::UserChangedFocus)
        );
        assert_eq!(
            restore_decision(&source, Some(target(1200, 0xb002)), 4, 11_000),
            Err(FocusRestoreReason::UserChangedFocus)
        );
        assert_eq!(
            restore_decision(&source, Some(target(1200, 0xa001)), 5, 11_000),
            Err(FocusRestoreReason::UserChangedFocus)
        );
    }

    #[test]
    fn expired_or_future_source_identity_is_never_restored() {
        let expired = identity(1_000, 2);
        assert_eq!(
            restore_decision(&expired, Some(target(1200, 0xa001)), 2, 301_001),
            Err(FocusRestoreReason::SourceExpired)
        );
        let future = identity(10_001, 2);
        assert_eq!(
            restore_decision(&future, Some(target(1200, 0xa001)), 2, 10_000),
            Err(FocusRestoreReason::SourceExpired)
        );
    }

    #[test]
    fn source_registry_is_bounded_and_keeps_exact_revisions() {
        let mut state = FocusState::default();
        let identity = identity(10_000, 2);
        let old = SnapshotKey {
            snapshot_id: "snapshot-a".to_owned(),
            revision: 1,
        };
        state.remember(old.clone(), identity.clone());
        state.remember(
            SnapshotKey {
                snapshot_id: "snapshot-a".to_owned(),
                revision: 2,
            },
            identity.clone(),
        );
        assert!(state.sources.contains_key(&old));
        assert!(state.sources.contains_key(&SnapshotKey {
            snapshot_id: "snapshot-a".to_owned(),
            revision: 2,
        }));

        for revision in 0..=MAX_REMEMBERED_SOURCES as u64 {
            state.remember(
                SnapshotKey {
                    snapshot_id: format!("snapshot-{revision}"),
                    revision: 1,
                },
                identity.clone(),
            );
        }
        assert!(state.sources.len() <= MAX_REMEMBERED_SOURCES);
    }
}
