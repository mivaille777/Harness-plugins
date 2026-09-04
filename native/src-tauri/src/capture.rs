use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::bridge::BridgeRuntime;
use crate::protocol::SelectionSnapshot;
use crate::providers::browser_accessibility::BrowserAccessibilityProvider;
use crate::providers::{ProviderCapture, SelectionProvider};

const CAPTURE_SETTLE_DELAY: Duration = Duration::from_millis(35);
const DEDUPE_WINDOW: Duration = Duration::from_millis(120);
const WORKER_POLL: Duration = Duration::from_millis(250);

pub struct CaptureRuntime {
    stop: Arc<AtomicBool>,
}

impl CaptureRuntime {
    pub fn start(app: AppHandle) -> Self {
        let stop = Arc::new(AtomicBool::new(false));

        #[cfg(windows)]
        start_windows_capture(app, stop.clone());

        #[cfg(not(windows))]
        let _ = app;

        Self { stop }
    }
}

impl Drop for CaptureRuntime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

#[cfg(windows)]
fn start_windows_capture(app: AppHandle, stop: Arc<AtomicBool>) {
    let (trigger_tx, trigger_rx) = mpsc::channel::<()>();
    let (snapshot_tx, mut snapshot_rx) = tokio::sync::mpsc::unbounded_channel::<SelectionSnapshot>();

    let event_stop = stop.clone();
    thread::Builder::new()
        .name("dsh-selection-uia-events".to_owned())
        .spawn(move || {
            if let Err(error) = run_selection_event_source(trigger_tx, event_stop) {
                eprintln!("[selection-companion] UIA selection event source stopped: {error}");
            }
        })
        .expect("failed to spawn UIA selection event thread");

    let worker_stop = stop.clone();
    thread::Builder::new()
        .name("dsh-selection-capture-worker".to_owned())
        .spawn(move || {
            let provider = BrowserAccessibilityProvider::default();
            let mut last_capture: Option<(u64, Instant)> = None;

            while !worker_stop.load(Ordering::Acquire) {
                match trigger_rx.recv_timeout(WORKER_POLL) {
                    Ok(()) => {
                        thread::sleep(CAPTURE_SETTLE_DELAY);
                        match provider.capture() {
                            Ok(ProviderCapture::Captured(snapshot)) => {
                                let signature = snapshot_signature(&snapshot);
                                if is_duplicate(&last_capture, signature, Instant::now()) {
                                    continue;
                                }
                                last_capture = Some((signature, Instant::now()));
                                if snapshot_tx.send(snapshot).is_err() {
                                    break;
                                }
                            }
                            Ok(ProviderCapture::NotApplicable | ProviderCapture::NoSelection) => {}
                            Err(error) => {
                                eprintln!("[selection-companion] browser accessibility capture failed: {error}");
                            }
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        })
        .expect("failed to spawn selection capture worker");

    tauri::async_runtime::spawn(async move {
        while let Some(snapshot) = snapshot_rx.recv().await {
            let bridge = app.state::<BridgeRuntime>();
            if let Err(error) = bridge.submit_selection(snapshot).await {
                eprintln!("[selection-companion] could not publish selection to Harness: {error}");
            }
        }
    });
}

#[cfg(windows)]
fn run_selection_event_source(trigger_tx: mpsc::Sender<()>, stop: Arc<AtomicBool>) -> Result<(), String> {
    use uiautomation::events::{CustomEventHandlerFn, UIEventHandler, UIEventType};
    use uiautomation::types::TreeScope;
    use uiautomation::UIAutomation;

    let automation = UIAutomation::new().map_err(|error| error.to_string())?;
    let root = automation
        .get_root_element()
        .map_err(|error| error.to_string())?;

    let callback: Box<CustomEventHandlerFn> = Box::new(move |_sender, _event| {
        let _ = trigger_tx.send(());
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

fn snapshot_signature(snapshot: &SelectionSnapshot) -> u64 {
    let mut hasher = DefaultHasher::new();
    snapshot.selection.text.hash(&mut hasher);
    snapshot.source.process.hash(&mut hasher);
    snapshot.source.window_title.hash(&mut hasher);
    snapshot.document.as_ref().and_then(|document| document.url.as_ref()).hash(&mut hasher);
    if let Some(geometry) = &snapshot.geometry {
        geometry.x.to_bits().hash(&mut hasher);
        geometry.y.to_bits().hash(&mut hasher);
        geometry.width.to_bits().hash(&mut hasher);
        geometry.height.to_bits().hash(&mut hasher);
    }
    hasher.finish()
}

fn is_duplicate(last: &Option<(u64, Instant)>, signature: u64, now: Instant) -> bool {
    matches!(last, Some((previous, captured_at)) if *previous == signature && now.duration_since(*captured_at) <= DEDUPE_WINDOW)
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
    fn dedupe_signature_changes_with_selection_text() {
        assert_ne!(snapshot_signature(&snapshot("alpha")), snapshot_signature(&snapshot("beta")));
    }

    #[test]
    fn duplicate_window_is_bounded() {
        let signature = snapshot_signature(&snapshot("alpha"));
        let captured_at = Instant::now();
        let last = Some((signature, captured_at));
        assert!(is_duplicate(&last, signature, captured_at + Duration::from_millis(100)));
        assert!(!is_duplicate(&last, signature, captured_at + Duration::from_millis(200)));
    }
}
