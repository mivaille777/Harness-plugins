use std::collections::hash_map::DefaultHasher;
use std::env;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc as tokio_mpsc;

use crate::bridge::BridgeRuntime;
use crate::protocol::SelectionSnapshot;
use crate::providers::browser_accessibility::BrowserAccessibilityProvider;
use crate::providers::{ProviderCapture, SelectionProvider};

const DEFAULT_CAPTURE_SETTLE_DELAY_MS: u64 = 35;
const DEFAULT_DEDUPE_WINDOW_MS: u64 = 120;
const DEFAULT_CONTEXT_CHARS: i32 = 900;
const WORKER_POLL: Duration = Duration::from_millis(250);
// Chromium does not reliably raise Text_TextSelectionChanged on every page. This
// bounded foreground read is a fallback, not a second capture transport.
const FALLBACK_SELECTION_POLL: Duration = Duration::from_millis(500);

#[derive(Debug, Clone)]
struct CaptureConfig {
    settle_delay: Duration,
    dedupe_window: Duration,
    context_chars: i32,
    excluded_applications: Vec<String>,
    excluded_url_hosts: Vec<String>,
}

impl CaptureConfig {
    fn from_environment() -> Result<Self, String> {
        Ok(Self {
            settle_delay: Duration::from_millis(read_u64(
                "DSH_SELECTION_CAPTURE_SETTLE_MS",
                DEFAULT_CAPTURE_SETTLE_DELAY_MS,
                0,
                1_000,
            )?),
            dedupe_window: Duration::from_millis(read_u64(
                "DSH_SELECTION_CAPTURE_DEDUPE_MS",
                DEFAULT_DEDUPE_WINDOW_MS,
                0,
                10_000,
            )?),
            context_chars: read_i32(
                "DSH_SELECTION_CONTEXT_CHARS",
                DEFAULT_CONTEXT_CHARS,
                1,
                20_000,
            )?,
            excluded_applications: read_csv("DSH_SELECTION_CAPTURE_EXCLUDED_APPS")?,
            excluded_url_hosts: read_csv("DSH_SELECTION_CAPTURE_EXCLUDED_URL_HOSTS")?,
        })
    }

    fn excludes(&self, snapshot: &SelectionSnapshot) -> bool {
        let mut app = snapshot
            .source
            .app
            .iter()
            .chain(snapshot.source.process.iter())
            .map(|value| value.to_ascii_lowercase());
        if app.any(|value| {
            self.excluded_applications
                .iter()
                .any(|excluded| value == *excluded)
        }) {
            return true;
        }

        snapshot
            .document
            .as_ref()
            .and_then(|document| document.url.as_deref())
            .and_then(url_host)
            .is_some_and(|host| {
                self.excluded_url_hosts
                    .iter()
                    .any(|excluded| host == *excluded)
            })
    }
}

fn read_u64(name: &str, default: u64, minimum: u64, maximum: u64) -> Result<u64, String> {
    let Some(value) = env::var_os(name) else {
        return Ok(default);
    };
    let value = value
        .to_string_lossy()
        .parse::<u64>()
        .map_err(|_| format!("{name} must be an integer from {minimum} to {maximum}"))?;
    if !(minimum..=maximum).contains(&value) {
        return Err(format!(
            "{name} must be an integer from {minimum} to {maximum}"
        ));
    }
    Ok(value)
}

fn read_i32(name: &str, default: i32, minimum: i32, maximum: i32) -> Result<i32, String> {
    let Some(value) = env::var_os(name) else {
        return Ok(default);
    };
    let value = value
        .to_string_lossy()
        .parse::<i32>()
        .map_err(|_| format!("{name} must be an integer from {minimum} to {maximum}"))?;
    if !(minimum..=maximum).contains(&value) {
        return Err(format!(
            "{name} must be an integer from {minimum} to {maximum}"
        ));
    }
    Ok(value)
}

fn read_csv(name: &str) -> Result<Vec<String>, String> {
    let Some(value) = env::var_os(name) else {
        return Ok(Vec::new());
    };
    let values = value
        .to_string_lossy()
        .split(',')
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    if values
        .iter()
        .any(|value| value.is_empty() || value.chars().any(char::is_control))
    {
        return Err(format!(
            "{name} must be a comma-separated list of non-empty names"
        ));
    }
    Ok(values)
}

fn url_host(url: &str) -> Option<String> {
    let (_, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?.split(':').next()?.trim();
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum CapturePhase {
    Running,
    Paused,
    NoSelection,
    NotApplicable,
    Excluded,
    Error,
    Publishing,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureMetrics {
    captured: u64,
    published: u64,
    deduplicated: u64,
    paused_drops: u64,
    coalesced: u64,
    no_selection: u64,
    not_applicable: u64,
    excluded: u64,
    errors: u64,
    last_capture_latency_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    paused: bool,
    phase: CapturePhase,
    queue_depth: usize,
    last_transition_at: u64,
    last_error: Option<String>,
    metrics: CaptureMetrics,
}

struct CaptureState {
    paused: bool,
    phase: CapturePhase,
    last_transition_at: u64,
    last_error: Option<String>,
    metrics: CaptureMetrics,
}

impl CaptureState {
    fn new() -> Self {
        Self {
            paused: false,
            phase: CapturePhase::Running,
            last_transition_at: now_millis(),
            last_error: None,
            metrics: CaptureMetrics::default(),
        }
    }

    fn transition(&mut self, phase: CapturePhase, error: Option<String>) {
        self.phase = phase;
        self.last_transition_at = now_millis();
        self.last_error = error;
    }
}

/// A bounded latest-value mailbox. A burst retains its most recent snapshot only.
struct LatestValue<T> {
    value: Mutex<Option<T>>,
}

impl<T> LatestValue<T> {
    fn new() -> Self {
        Self {
            value: Mutex::new(None),
        }
    }

    fn replace(&self, value: T) -> bool {
        self.value
            .lock()
            .expect("capture latest-value mailbox poisoned")
            .replace(value)
            .is_some()
    }

    fn take(&self) -> Option<T> {
        self.value
            .lock()
            .expect("capture latest-value mailbox poisoned")
            .take()
    }

    fn clear(&self) -> bool {
        self.value
            .lock()
            .expect("capture latest-value mailbox poisoned")
            .take()
            .is_some()
    }

    fn len(&self) -> usize {
        usize::from(
            self.value
                .lock()
                .expect("capture latest-value mailbox poisoned")
                .is_some(),
        )
    }
}

pub struct CaptureRuntime {
    stop: Arc<AtomicBool>,
    state: Arc<Mutex<CaptureState>>,
    latest: Arc<LatestValue<SelectionSnapshot>>,
    threads: Mutex<Vec<thread::JoinHandle<()>>>,
}

impl CaptureRuntime {
    pub fn start(app: AppHandle) -> Result<Self, String> {
        let config = CaptureConfig::from_environment()?;
        let runtime = Self {
            stop: Arc::new(AtomicBool::new(false)),
            state: Arc::new(Mutex::new(CaptureState::new())),
            latest: Arc::new(LatestValue::new()),
            threads: Mutex::new(Vec::new()),
        };

        #[cfg(windows)]
        runtime.start_windows_capture(app, config)?;

        #[cfg(not(windows))]
        let _ = (app, config);

        Ok(runtime)
    }

    fn status(&self) -> CaptureStatus {
        let state = self.state.lock().expect("capture state poisoned");
        CaptureStatus {
            paused: state.paused,
            phase: state.phase,
            queue_depth: self.latest.len(),
            last_transition_at: state.last_transition_at,
            last_error: state.last_error.clone(),
            metrics: state.metrics.clone(),
        }
    }

    fn pause(&self) {
        self.latest.clear();
        let mut state = self.state.lock().expect("capture state poisoned");
        state.paused = true;
        state.transition(CapturePhase::Paused, None);
    }

    fn resume(&self) {
        let mut state = self.state.lock().expect("capture state poisoned");
        state.paused = false;
        state.transition(CapturePhase::Running, None);
    }

    #[cfg(windows)]
    fn start_windows_capture(&self, app: AppHandle, config: CaptureConfig) -> Result<(), String> {
        // Capacity one intentionally coalesces bursts of UIA events for one gesture.
        let (trigger_tx, trigger_rx) = mpsc::sync_channel::<()>(1);
        let (ready_tx, mut ready_rx) = tokio_mpsc::channel::<()>(1);

        let event_stop = self.stop.clone();
        let event_state = self.state.clone();
        let event_thread = thread::Builder::new()
            .name("dsh-selection-uia-events".to_owned())
            .spawn(move || {
                if let Err(error) = run_selection_event_source(trigger_tx, event_stop) {
                    record_error(
                        &event_state,
                        format!("UIA selection event source stopped: {error}"),
                    );
                }
            })
            .map_err(|error| format!("failed to spawn UIA selection event thread: {error}"))?;

        let worker_stop = self.stop.clone();
        let worker_state = self.state.clone();
        let worker_latest = self.latest.clone();
        let worker_thread = thread::Builder::new()
            .name("dsh-selection-capture-worker".to_owned())
            .spawn(move || {
                let provider = match BrowserAccessibilityProvider::new(config.context_chars) {
                    Ok(provider) => provider,
                    Err(error) => {
                        record_error(
                            &worker_state,
                            format!("could not initialize browser accessibility provider: {error}"),
                        );
                        return;
                    }
                };
                let mut last_capture: Option<(u64, Instant)> = None;
                let mut last_polled_signature: Option<u64> = None;
                let mut next_fallback_poll = Instant::now() + FALLBACK_SELECTION_POLL;

                while !worker_stop.load(Ordering::Acquire) {
                    match trigger_rx.recv_timeout(WORKER_POLL) {
                        Ok(()) => {
                            if is_paused(&worker_state) {
                                increment(&worker_state, |metrics| metrics.paused_drops += 1);
                                continue;
                            }
                            thread::sleep(config.settle_delay);
                            if is_paused(&worker_state) {
                                increment(&worker_state, |metrics| metrics.paused_drops += 1);
                                continue;
                            }

                            let started = Instant::now();
                            match provider.capture() {
                                Ok(ProviderCapture::Captured(snapshot)) => {
                                    let latency = started.elapsed().as_millis() as u64;
                                    if is_paused(&worker_state) {
                                        increment(&worker_state, |metrics| {
                                            metrics.paused_drops += 1
                                        });
                                        continue;
                                    }
                                    if config.excludes(&snapshot) {
                                        transition(&worker_state, CapturePhase::Excluded, None);
                                        increment(&worker_state, |metrics| metrics.excluded += 1);
                                        continue;
                                    }
                                    let signature = snapshot_signature(&snapshot);
                                    let now = Instant::now();
                                    if is_duplicate(
                                        &last_capture,
                                        signature,
                                        now,
                                        config.dedupe_window,
                                    ) {
                                        increment(&worker_state, |metrics| {
                                            metrics.deduplicated += 1
                                        });
                                        continue;
                                    }
                                    last_capture = Some((signature, now));
                                    let replaced = worker_latest.replace(snapshot);
                                    let _ = ready_tx.try_send(());
                                    transition(&worker_state, CapturePhase::Publishing, None);
                                    increment(&worker_state, |metrics| {
                                        metrics.captured += 1;
                                        metrics.last_capture_latency_ms = Some(latency);
                                        if replaced {
                                            metrics.coalesced += 1;
                                        }
                                    });
                                }
                                Ok(ProviderCapture::NoSelection) => {
                                    transition(&worker_state, CapturePhase::NoSelection, None);
                                    increment(&worker_state, |metrics| metrics.no_selection += 1);
                                }
                                Ok(ProviderCapture::NotApplicable) => {
                                    transition(&worker_state, CapturePhase::NotApplicable, None);
                                    increment(&worker_state, |metrics| metrics.not_applicable += 1);
                                }
                                Err(error) => record_error(
                                    &worker_state,
                                    format!("browser accessibility capture failed: {error}"),
                                ),
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if Instant::now() < next_fallback_poll || is_paused(&worker_state) {
                                continue;
                            }
                            next_fallback_poll = Instant::now() + FALLBACK_SELECTION_POLL;
                            match provider.capture() {
                                Ok(ProviderCapture::Captured(snapshot)) => {
                                    let signature = snapshot_signature(&snapshot);
                                    // A fallback read observes the same active selection repeatedly.
                                    // Keep one fingerprint until focus moves away or selection clears.
                                    if last_polled_signature == Some(signature)
                                        || last_capture
                                            .as_ref()
                                            .is_some_and(|(previous, _)| *previous == signature)
                                    {
                                        last_polled_signature = Some(signature);
                                        continue;
                                    }
                                    last_polled_signature = Some(signature);
                                    let started = Instant::now();
                                    let latency = started.elapsed().as_millis() as u64;
                                    let replaced = worker_latest.replace(snapshot);
                                    let _ = ready_tx.try_send(());
                                    last_capture = Some((signature, Instant::now()));
                                    transition(&worker_state, CapturePhase::Publishing, None);
                                    increment(&worker_state, |metrics| {
                                        metrics.captured += 1;
                                        metrics.last_capture_latency_ms = Some(latency);
                                        if replaced {
                                            metrics.coalesced += 1;
                                        }
                                    });
                                }
                                Ok(
                                    ProviderCapture::NoSelection | ProviderCapture::NotApplicable,
                                ) => {
                                    // Clearing this allows an identical later selection to become a
                                    // deliberate new capture after the user returns to the browser.
                                    last_polled_signature = None;
                                    last_capture = None;
                                }
                                Err(error) => record_error(
                                    &worker_state,
                                    format!(
                                        "browser accessibility fallback capture failed: {error}"
                                    ),
                                ),
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .map_err(|error| format!("failed to spawn selection capture worker: {error}"))?;

        let publisher_stop = self.stop.clone();
        let publisher_state = self.state.clone();
        let publisher_latest = self.latest.clone();
        tauri::async_runtime::spawn(async move {
            while ready_rx.recv().await.is_some() {
                if publisher_stop.load(Ordering::Acquire) || is_paused(&publisher_state) {
                    publisher_latest.clear();
                    continue;
                }
                let Some(snapshot) = publisher_latest.take() else {
                    continue;
                };
                let bridge = app.state::<BridgeRuntime>();
                let published_snapshot_id = snapshot.id.clone();
                let published_revision = snapshot.revision;
                match bridge.submit_selection(snapshot).await {
                    Ok(()) => {
                        transition(&publisher_state, CapturePhase::Running, None);
                        increment(&publisher_state, |metrics| metrics.published += 1);
                        // The UI receives identity only and reads the canonical snapshot back from
                        // Harness. Selection text never travels in this local notification.
                        let _ = app.emit(
                            "selection-captured",
                            serde_json::json!({
                                "snapshotId": published_snapshot_id,
                                "revision": published_revision,
                            }),
                        );
                    }
                    Err(error) => record_error(
                        &publisher_state,
                        format!("could not publish selection to Harness: {error}"),
                    ),
                }
            }
        });

        self.threads
            .lock()
            .expect("capture threads poisoned")
            .extend([event_thread, worker_thread]);
        Ok(())
    }
}

impl Drop for CaptureRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        for thread in self
            .threads
            .get_mut()
            .expect("capture threads poisoned")
            .drain(..)
        {
            let _ = thread.join();
        }
    }
}

fn is_paused(state: &Mutex<CaptureState>) -> bool {
    state.lock().expect("capture state poisoned").paused
}

fn increment(state: &Mutex<CaptureState>, update: impl FnOnce(&mut CaptureMetrics)) {
    update(&mut state.lock().expect("capture state poisoned").metrics);
}

fn transition(state: &Mutex<CaptureState>, phase: CapturePhase, error: Option<String>) {
    state
        .lock()
        .expect("capture state poisoned")
        .transition(phase, error);
}

fn record_error(state: &Mutex<CaptureState>, error: String) {
    let mut state = state.lock().expect("capture state poisoned");
    state.metrics.errors += 1;
    state.transition(CapturePhase::Error, Some(error));
}

#[tauri::command]
pub fn capture_status(state: State<'_, CaptureRuntime>) -> Result<CaptureStatus, String> {
    Ok(state.status())
}

#[tauri::command]
pub fn capture_pause(state: State<'_, CaptureRuntime>) -> Result<CaptureStatus, String> {
    state.pause();
    Ok(state.status())
}

#[tauri::command]
pub fn capture_resume(state: State<'_, CaptureRuntime>) -> Result<CaptureStatus, String> {
    state.resume();
    Ok(state.status())
}

#[cfg(windows)]
fn run_selection_event_source(
    trigger_tx: mpsc::SyncSender<()>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    use uiautomation::events::{CustomEventHandlerFn, UIEventHandler, UIEventType};
    use uiautomation::types::TreeScope;
    use uiautomation::UIAutomation;

    let automation = UIAutomation::new().map_err(|error| error.to_string())?;
    let root = automation
        .get_root_element()
        .map_err(|error| error.to_string())?;

    let callback: Box<CustomEventHandlerFn> = Box::new(move |_sender, _event| {
        let _ = trigger_tx.try_send(());
        Ok(())
    });
    let handler = UIEventHandler::from(callback);

    automation
        .add_automation_event_handler(
            UIEventType::Text_TextSelectionChanged,
            &root,
            TreeScope::Subtree,
            None,
            &handler,
        )
        .map_err(|error| error.to_string())?;

    while !stop.load(Ordering::Acquire) {
        thread::sleep(WORKER_POLL);
    }

    automation
        .remove_automation_event_handler(UIEventType::Text_TextSelectionChanged, &root, &handler)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn snapshot_signature(snapshot: &SelectionSnapshot) -> u64 {
    let mut hasher = DefaultHasher::new();
    snapshot.selection.text.hash(&mut hasher);
    snapshot.source.process.hash(&mut hasher);
    snapshot.source.window_title.hash(&mut hasher);
    snapshot
        .document
        .as_ref()
        .and_then(|document| document.url.as_ref())
        .hash(&mut hasher);
    if let Some(geometry) = &snapshot.geometry {
        geometry.x.to_bits().hash(&mut hasher);
        geometry.y.to_bits().hash(&mut hasher);
        geometry.width.to_bits().hash(&mut hasher);
        geometry.height.to_bits().hash(&mut hasher);
    }
    hasher.finish()
}

fn is_duplicate(
    last: &Option<(u64, Instant)>,
    signature: u64,
    now: Instant,
    dedupe_window: Duration,
) -> bool {
    matches!(last, Some((previous, captured_at)) if *previous == signature && now.duration_since(*captured_at) <= dedupe_window)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{
        SelectionCapabilities, SelectionContext, SelectionSource, SelectionSourceKind,
        SelectionValue,
    };

    fn snapshot(text: &str) -> SelectionSnapshot {
        SelectionSnapshot {
            id: "test-selection".to_owned(),
            revision: 1,
            captured_at: 1,
            selection: SelectionValue {
                text: text.to_owned(),
                language: None,
            },
            source: SelectionSource {
                kind: SelectionSourceKind::Browser,
                app: Some("Google Chrome".to_owned()),
                process: Some("chrome.exe".to_owned()),
                window_title: Some("Paper - Google Chrome".to_owned()),
            },
            document: None,
            context: SelectionContext {
                before: None,
                after: None,
                section_text: None,
                page_text: None,
                page_available: false,
            },
            capabilities: SelectionCapabilities {
                local_context: false,
                section_context: false,
                page_context: false,
                screenshot: false,
            },
            geometry: None,
            provider: "browser-accessibility".to_owned(),
            confidence: 0.4,
        }
    }

    #[test]
    fn latest_value_queue_is_bounded_and_keeps_the_latest_selection() {
        let queue = LatestValue::new();
        assert!(!queue.replace(snapshot("A")));
        assert!(queue.replace(snapshot("B")));
        assert_eq!(queue.len(), 1);
        assert_eq!(queue.take().unwrap().selection.text, "B");
        assert_eq!(queue.len(), 0);
    }

    #[test]
    fn pausing_clears_pending_selection_without_changing_published_state() {
        let runtime = CaptureRuntime {
            stop: Arc::new(AtomicBool::new(false)),
            state: Arc::new(Mutex::new(CaptureState::new())),
            latest: Arc::new(LatestValue::new()),
            threads: Mutex::new(Vec::new()),
        };
        runtime.latest.replace(snapshot("pending"));
        runtime.pause();
        let status = runtime.status();
        assert!(status.paused);
        assert_eq!(status.phase, CapturePhase::Paused);
        assert_eq!(status.queue_depth, 0);
        runtime.resume();
        assert!(!runtime.status().paused);
    }

    #[test]
    fn dedupe_signature_changes_with_selection_text() {
        assert_ne!(
            snapshot_signature(&snapshot("alpha")),
            snapshot_signature(&snapshot("beta"))
        );
    }

    #[test]
    fn duplicate_window_is_bounded_by_configured_duration() {
        let signature = snapshot_signature(&snapshot("alpha"));
        let captured_at = Instant::now();
        let last = Some((signature, captured_at));
        assert!(is_duplicate(
            &last,
            signature,
            captured_at + Duration::from_millis(100),
            Duration::from_millis(120),
        ));
        assert!(!is_duplicate(
            &last,
            signature,
            captured_at + Duration::from_millis(200),
            Duration::from_millis(120),
        ));
    }

    #[test]
    fn exclusion_matches_applications_and_url_hosts_without_logging_content() {
        let config = CaptureConfig {
            settle_delay: Duration::ZERO,
            dedupe_window: Duration::ZERO,
            context_chars: 1,
            excluded_applications: vec!["chrome.exe".to_owned()],
            excluded_url_hosts: vec!["private.example".to_owned()],
        };
        assert!(config.excludes(&snapshot("sensitive text")));
        assert_eq!(
            url_host("https://private.example/a?token=secret"),
            Some("private.example".to_owned())
        );
        assert_eq!(url_host("not a url"), None);
    }
}
