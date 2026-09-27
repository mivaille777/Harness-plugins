pub mod bridge;
pub mod capture;
pub mod focus;
pub mod interaction_guard;
pub mod native_messaging;
pub mod protocol;
pub mod providers;
pub mod submission;
pub mod submission_material;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(bridge::BridgeRuntime::from_environment().expect("invalid bridge configuration"))
        .setup(|app| {
            let guard = interaction_guard::InteractionGuard::default();
            let focus = focus::FocusRuntime::start()?;
            let capture = capture::CaptureRuntime::start(
                app.handle().clone(),
                guard.clone(),
                focus.clone(),
            )?;
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
            bridge::bridge_expand_selection,
            submission::bridge_submit_authorized_prompt,
            bridge::bridge_list_sessions,
            bridge::bridge_create_session,
            bridge::bridge_read_session_history,
            bridge::bridge_subscribe_session,
            bridge::bridge_unsubscribe_session,
            bridge::bridge_cancel_session,
            capture::capture_status,
            capture::capture_pause,
            capture::capture_resume,
            interaction_guard::interaction_guard_begin,
            interaction_guard::interaction_guard_end,
            focus::restore_source_focus,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run dsh-selection-companion native shell");
}
