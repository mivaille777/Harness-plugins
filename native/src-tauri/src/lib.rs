pub mod bridge;
pub mod capture;
pub mod focus;
pub mod interaction_guard;
pub mod native_messaging;
pub mod pipe_connection;
pub mod protocol;
pub mod providers;
pub mod runtime_diagnostics;
pub mod submission;
pub mod submission_material;
pub mod window_lifecycle;

use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .manage(bridge::BridgeRuntime::from_environment().expect("invalid bridge configuration"))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(metrics) = window
                    .app_handle()
                    .try_state::<window_lifecycle::WindowLifecycleMetrics>()
                {
                    metrics.record_destroyed();
                }
            }
        })
        .setup(|app| {
            let initial_window_count = app.webview_windows().len();
            app.manage(
                window_lifecycle::WindowLifecycleMetrics::with_initial_windows(
                    initial_window_count,
                ),
            );
            #[cfg(windows)]
            {
                let mut bridge_events = app.state::<bridge::BridgeRuntime>().subscribe_events();
                let event_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        match bridge_events.recv().await {
                            Ok(event) => {
                                let _ = event_app.emit("native-bridge-event", event);
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                                eprintln!(
                                    "[native-bridge] UI event listener skipped {skipped} events"
                                );
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                });
            }
            let guard = interaction_guard::InteractionGuard::default();
            let focus = focus::FocusRuntime::start()?;
            let capture =
                capture::CaptureRuntime::start(app.handle().clone(), guard.clone(), focus.clone())?;
            app.manage(guard.clone());
            app.manage(focus);
            app.manage(capture);
            guard.start_reaper(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_status,
            bridge::bridge_connect,
            bridge::bridge_ping,
            bridge::bridge_disconnect,
            bridge::bridge_current_selection,
            bridge::bridge_selection_cache_status,
            bridge::bridge_expand_selection,
            submission::bridge_submit_authorized_prompt,
            bridge::bridge_list_sessions,
            bridge::bridge_create_session,
            bridge::bridge_choose_workspace_and_create_session,
            bridge::bridge_read_session_history,
            bridge::bridge_subscribe_session,
            bridge::bridge_unsubscribe_session,
            bridge::bridge_cancel_session,
            capture::capture_status,
            capture::capture_pause,
            capture::capture_resume,
            interaction_guard::interaction_guard_begin,
            interaction_guard::interaction_guard_end,
            interaction_guard::interaction_guard_status,
            focus::restore_source_focus,
            runtime_diagnostics::runtime_memory_status,
            window_lifecycle::runtime_window_lifecycle_status,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run dsh-selection-companion native shell");
}
