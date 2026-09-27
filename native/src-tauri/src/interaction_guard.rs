use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

const MAX_GUARD_TIMEOUT: Duration = Duration::from_secs(60);
const GUARD_REAPER_INTERVAL: Duration = Duration::from_millis(200);
const OVERLAY_WINDOWS: [&str; 2] = ["main", "entry"];

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum InteractionMode {
    AgentInput,
    ScreenCapture,
    LensInteraction,
    CapturePaused,
    Shutdown,
}

impl InteractionMode {
    fn blocks_capture(self) -> bool {
        matches!(
            self,
            Self::AgentInput | Self::ScreenCapture | Self::LensInteraction | Self::CapturePaused
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionStatus {
    pub capture_suppressed: bool,
    pub shutting_down: bool,
    pub generation: u64,
    pub active_requests: usize,
    pub active_modes: Vec<InteractionMode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureGate {
    pub suppressed: bool,
    pub generation: u64,
}

#[derive(Debug, Default)]
pub(crate) struct GuardEffects {
    hide_windows: Vec<String>,
    restore_windows: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct GuardKey {
    mode: InteractionMode,
    request_id: String,
}

#[derive(Debug)]
struct GuardLease {
    expires_at: Instant,
}

#[derive(Debug, Default)]
struct GuardState {
    leases: HashMap<GuardKey, GuardLease>,
    generation: u64,
    user_capture_paused: bool,
    shutting_down: bool,
    screen_capture_restore: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default)]
pub struct InteractionGuard {
    state: Arc<Mutex<GuardState>>,
}

impl InteractionGuard {
    pub(crate) fn begin(
        &self,
        mode: InteractionMode,
        request_id: &str,
        timeout: Duration,
        visible_overlays: &[String],
    ) -> Result<(InteractionStatus, GuardEffects), String> {
        if mode == InteractionMode::Shutdown {
            return Err("shutdown state is managed by the native lifecycle".into());
        }
        validate_request(request_id, timeout)?;

        let now = Instant::now();
        let mut state = self.state.lock().expect("interaction guard poisoned");
        if state.shutting_down {
            return Err("interaction guard is shutting down".into());
        }
        let mut effects = expire_due_locked(&mut state, now);
        let key = GuardKey {
            mode,
            request_id: request_id.to_owned(),
        };
        let was_present = state.leases.contains_key(&key);
        let had_screen_capture = has_stored_mode(&state, InteractionMode::ScreenCapture);
        state.leases.insert(
            key,
            GuardLease {
                expires_at: now + timeout,
            },
        );
        if mode.blocks_capture() && !was_present {
            state.generation = state.generation.wrapping_add(1);
        }
        if mode == InteractionMode::ScreenCapture && !had_screen_capture {
            let visible = visible_overlays.to_vec();
            state.screen_capture_restore = Some(visible.clone());
            effects.hide_windows = visible;
        }
        Ok((status(&state), effects))
    }

    pub(crate) fn end(
        &self,
        mode: InteractionMode,
        request_id: &str,
    ) -> (bool, InteractionStatus, GuardEffects) {
        let mut state = self.state.lock().expect("interaction guard poisoned");
        let key = GuardKey {
            mode,
            request_id: request_id.to_owned(),
        };
        let ended = state.leases.remove(&key).is_some();
        let mut effects = GuardEffects::default();
        if ended && mode.blocks_capture() {
            state.generation = state.generation.wrapping_add(1);
        }
        if ended
            && mode == InteractionMode::ScreenCapture
            && !has_stored_mode(&state, InteractionMode::ScreenCapture)
        {
            effects.restore_windows = state.screen_capture_restore.take().unwrap_or_default();
        }
        (ended, status(&state), effects)
    }

    pub fn capture_gate(&self) -> CaptureGate {
        let state = self.state.lock().expect("interaction guard poisoned");
        CaptureGate {
            suppressed: capture_suppressed(&state),
            generation: state.generation,
        }
    }

    pub fn snapshot_status(&self) -> InteractionStatus {
        let state = self.state.lock().expect("interaction guard poisoned");
        status(&state)
    }

    pub fn set_user_capture_paused(&self, paused: bool) {
        let mut state = self.state.lock().expect("interaction guard poisoned");
        if state.user_capture_paused != paused {
            state.user_capture_paused = paused;
            state.generation = state.generation.wrapping_add(1);
        }
    }

    pub(crate) fn expire_due(&self) -> (InteractionStatus, GuardEffects) {
        let now = Instant::now();
        let mut state = self.state.lock().expect("interaction guard poisoned");
        let effects = expire_due_locked(&mut state, now);
        (status(&state), effects)
    }

    pub fn shutdown(&self) -> InteractionStatus {
        let mut state = self.state.lock().expect("interaction guard poisoned");
        if !state.shutting_down {
            state.shutting_down = true;
            state.generation = state.generation.wrapping_add(1);
        }
        state.leases.clear();
        state.user_capture_paused = false;
        state.screen_capture_restore = None;
        status(&state)
    }

    pub fn is_shutting_down(&self) -> bool {
        self.state
            .lock()
            .expect("interaction guard poisoned")
            .shutting_down
    }

    pub fn enter(
        &self,
        mode: InteractionMode,
        request_id: impl Into<String>,
        timeout: Duration,
    ) -> Result<InteractionLease, String> {
        if !matches!(
            mode,
            InteractionMode::AgentInput | InteractionMode::LensInteraction
        ) {
            return Err("RAII guards support AgentInput and LensInteraction modes only".into());
        }
        let request_id = request_id.into();
        self.begin(mode, &request_id, timeout, &[])?;
        Ok(InteractionLease {
            guard: self.clone(),
            mode,
            request_id,
        })
    }

    pub(crate) fn start_reaper(&self, app: AppHandle) {
        let guard = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(GUARD_REAPER_INTERVAL).await;
                let (_, effects) = guard.expire_due();
                restore_overlays(&app, effects.restore_windows);
                if guard.is_shutting_down() {
                    break;
                }
            }
        });
    }
}

pub struct InteractionLease {
    guard: InteractionGuard,
    mode: InteractionMode,
    request_id: String,
}

impl Drop for InteractionLease {
    fn drop(&mut self) {
        let (_, _, effects) = self.guard.end(self.mode, &self.request_id);
        debug_assert!(effects.hide_windows.is_empty() && effects.restore_windows.is_empty());
    }
}

fn validate_request(request_id: &str, timeout: Duration) -> Result<(), String> {
    if request_id.trim().is_empty()
        || request_id.len() > 256
        || request_id.chars().any(char::is_control)
    {
        return Err("interaction request id must be non-empty and at most 256 characters".into());
    }
    if timeout.is_zero() || timeout > MAX_GUARD_TIMEOUT {
        return Err(format!(
            "interaction guard timeout must be between 1 ms and {} ms",
            MAX_GUARD_TIMEOUT.as_millis()
        ));
    }
    Ok(())
}

fn has_stored_mode(state: &GuardState, mode: InteractionMode) -> bool {
    state.leases.keys().any(|key| key.mode == mode)
}

fn capture_suppressed(state: &GuardState) -> bool {
    state.user_capture_paused
        || state.shutting_down
        || state.leases.keys().any(|key| key.mode.blocks_capture())
}

fn status(state: &GuardState) -> InteractionStatus {
    let mut active_modes = state.leases.keys().map(|key| key.mode).collect::<Vec<_>>();
    if state.user_capture_paused {
        active_modes.push(InteractionMode::CapturePaused);
    }
    if state.shutting_down {
        active_modes.push(InteractionMode::Shutdown);
    }
    active_modes.sort_unstable();
    active_modes.dedup();
    InteractionStatus {
        capture_suppressed: capture_suppressed(state),
        shutting_down: state.shutting_down,
        generation: state.generation,
        active_requests: state.leases.len(),
        active_modes,
    }
}

fn expire_due_locked(state: &mut GuardState, now: Instant) -> GuardEffects {
    let expired_blocking = state
        .leases
        .iter()
        .any(|(key, lease)| key.mode.blocks_capture() && lease.expires_at <= now);
    let expired_screen_capture = state
        .leases
        .iter()
        .any(|(key, lease)| key.mode == InteractionMode::ScreenCapture && lease.expires_at <= now);
    state.leases.retain(|_, lease| lease.expires_at > now);

    let mut effects = GuardEffects::default();
    if expired_blocking {
        state.generation = state.generation.wrapping_add(1);
    }
    if expired_screen_capture && !has_stored_mode(state, InteractionMode::ScreenCapture) {
        effects.restore_windows = state.screen_capture_restore.take().unwrap_or_default();
    }
    effects
}

fn restore_overlays(app: &AppHandle, labels: Vec<String>) {
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.show();
        }
    }
}

fn visible_overlay_windows(app: &AppHandle) -> Result<Vec<String>, String> {
    let mut visible_labels = Vec::new();
    for label in OVERLAY_WINDOWS {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        let visible = window
            .is_visible()
            .map_err(|error| format!("could not inspect {label} window visibility: {error}"))?;
        if visible {
            visible_labels.push(label.to_owned());
        }
    }
    Ok(visible_labels)
}

fn hide_overlays(app: &AppHandle, labels: &[String]) -> Result<(), String> {
    let mut hidden = Vec::new();
    for label in labels {
        let Some(window) = app.get_webview_window(label) else {
            continue;
        };
        if let Err(error) = window.hide() {
            restore_overlays(app, hidden);
            return Err(format!(
                "could not hide {label} overlay before screen capture: {error}"
            ));
        }
        hidden.push(label.clone());
    }
    Ok(())
}

#[tauri::command]
pub fn interaction_guard_status(
    app: AppHandle,
    guard: State<'_, InteractionGuard>,
) -> InteractionStatus {
    let (_, effects) = guard.expire_due();
    restore_overlays(&app, effects.restore_windows);
    guard.snapshot_status()
}

#[tauri::command]
pub fn interaction_guard_begin(
    app: AppHandle,
    guard: State<'_, InteractionGuard>,
    mode: InteractionMode,
    request_id: String,
    timeout_ms: u64,
) -> Result<InteractionStatus, String> {
    let (_, expired) = guard.expire_due();
    restore_overlays(&app, expired.restore_windows);
    let visible = if mode == InteractionMode::ScreenCapture {
        visible_overlay_windows(&app)?
    } else {
        Vec::new()
    };
    let (status, effects) = guard.begin(
        mode,
        &request_id,
        Duration::from_millis(timeout_ms),
        &visible,
    )?;
    restore_overlays(&app, effects.restore_windows);
    if let Err(error) = hide_overlays(&app, &effects.hide_windows) {
        let (_, _, effects) = guard.end(mode, &request_id);
        restore_overlays(&app, effects.restore_windows);
        return Err(error);
    }
    Ok(status)
}

#[tauri::command]
pub fn interaction_guard_end(
    app: AppHandle,
    guard: State<'_, InteractionGuard>,
    mode: InteractionMode,
    request_id: String,
) -> InteractionStatus {
    let (_, expired) = guard.expire_due();
    restore_overlays(&app, expired.restore_windows);
    let (_, status, effects) = guard.end(mode, &request_id);
    restore_overlays(&app, effects.restore_windows);
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timeout() -> Duration {
        Duration::from_secs(2)
    }

    #[test]
    fn beginning_and_ending_lens_interaction_suppresses_capture() {
        let guard = InteractionGuard::default();
        let initial = guard.capture_gate();
        let (active, _) = guard
            .begin(
                InteractionMode::LensInteraction,
                "lens-focus",
                timeout(),
                &[],
            )
            .unwrap();
        assert!(active.capture_suppressed);
        assert!(active.generation > initial.generation);

        let (ended, status, _) = guard.end(InteractionMode::LensInteraction, "lens-focus");
        assert!(ended);
        assert!(!status.capture_suppressed);
    }

    #[test]
    fn nested_agent_and_lens_guards_do_not_resume_capture_early() {
        let guard = InteractionGuard::default();
        let (agent_active, _) = guard
            .begin(InteractionMode::AgentInput, "agent-1", timeout(), &[])
            .unwrap();
        assert!(agent_active.capture_suppressed);
        guard
            .begin(InteractionMode::LensInteraction, "lens-1", timeout(), &[])
            .unwrap();

        let (_, after_lens, _) = guard.end(InteractionMode::LensInteraction, "lens-1");
        assert!(after_lens.capture_suppressed);
        let (_, after_agent, _) = guard.end(InteractionMode::AgentInput, "agent-1");
        assert!(!after_agent.capture_suppressed);
    }

    #[test]
    fn screen_capture_restores_only_originally_visible_windows_after_nested_leases_end() {
        let guard = InteractionGuard::default();
        let visible = vec!["main".to_owned(), "entry".to_owned()];
        let (_, first_effects) = guard
            .begin(
                InteractionMode::ScreenCapture,
                "shot-1",
                timeout(),
                &visible,
            )
            .unwrap();
        assert_eq!(first_effects.hide_windows, visible);
        let (_, nested_effects) = guard
            .begin(InteractionMode::ScreenCapture, "shot-2", timeout(), &[])
            .unwrap();
        assert!(nested_effects.hide_windows.is_empty());

        let (_, _, nested_end) = guard.end(InteractionMode::ScreenCapture, "shot-1");
        assert!(nested_end.restore_windows.is_empty());
        let (_, status, final_end) = guard.end(InteractionMode::ScreenCapture, "shot-2");
        assert!(!status.capture_suppressed);
        assert_eq!(final_end.restore_windows, visible);
    }

    #[test]
    fn expired_guards_restore_overlays_and_advance_generation() {
        let guard = InteractionGuard::default();
        let visible = vec!["main".to_owned()];
        let (active, _) = guard
            .begin(
                InteractionMode::ScreenCapture,
                "shot-expired",
                Duration::from_millis(2),
                &visible,
            )
            .unwrap();
        std::thread::sleep(Duration::from_millis(5));

        let (status, effects) = guard.expire_due();
        assert!(!status.capture_suppressed);
        assert!(status.generation > active.generation);
        assert_eq!(effects.restore_windows, visible);
    }

    #[test]
    fn duplicate_end_is_harmless_and_duplicate_begin_refreshes_one_request() {
        let guard = InteractionGuard::default();
        guard
            .begin(InteractionMode::AgentInput, "agent-1", timeout(), &[])
            .unwrap();
        let (status, _) = guard
            .begin(InteractionMode::AgentInput, "agent-1", timeout(), &[])
            .unwrap();
        assert_eq!(status.active_requests, 1);
        assert!(guard.end(InteractionMode::AgentInput, "agent-1").0);
        assert!(!guard.end(InteractionMode::AgentInput, "agent-1").0);
    }

    #[test]
    fn user_pause_is_an_independent_nested_capture_blocker() {
        let guard = InteractionGuard::default();
        guard.set_user_capture_paused(true);
        guard
            .begin(InteractionMode::LensInteraction, "lens-1", timeout(), &[])
            .unwrap();
        guard.set_user_capture_paused(false);
        assert!(guard.capture_gate().suppressed);
        guard.end(InteractionMode::LensInteraction, "lens-1");
        assert!(!guard.capture_gate().suppressed);
    }

    #[test]
    fn shutdown_rejects_new_guards_and_suppresses_capture() {
        let guard = InteractionGuard::default();
        let status = guard.shutdown();
        assert!(status.shutting_down);
        assert!(status.capture_suppressed);
        assert!(guard
            .begin(InteractionMode::AgentInput, "late", timeout(), &[])
            .is_err());
    }

    #[test]
    fn raii_lease_ends_even_when_the_operation_returns_an_error() {
        let guard = InteractionGuard::default();
        let result: Result<(), &str> = (|| {
            let _lease = guard
                .enter(InteractionMode::AgentInput, "agent-raii", timeout())
                .unwrap();
            assert!(guard.capture_gate().suppressed);
            Err("operation failed")
        })();

        assert_eq!(result, Err("operation failed"));
        assert!(!guard.capture_gate().suppressed);
    }

    #[test]
    fn aborting_agent_input_scope_releases_capture_guard() {
        let guard = InteractionGuard::default();
        let lease = guard
            .enter(InteractionMode::AgentInput, "agent-abort", timeout())
            .unwrap();
        assert!(guard.capture_gate().suppressed);

        drop(lease);

        assert!(!guard.capture_gate().suppressed);
    }
}
