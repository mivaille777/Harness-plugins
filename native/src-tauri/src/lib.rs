pub mod bridge;
pub mod capture;
pub mod native_messaging;
pub mod protocol;
pub mod providers;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(bridge::BridgeRuntime::from_environment().expect("invalid bridge configuration"))
        .setup(|app| {
            let capture = capture::CaptureRuntime::start(app.handle().clone())?;
            app.manage(capture);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_status,
            bridge::bridge_connect,
            bridge::bridge_ping,
            bridge::bridge_disconnect,
            bridge::bridge_current_selection,
            bridge::bridge_submit_prompt,
            capture::capture_status,
            capture::capture_pause,
            capture::capture_resume,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run dsh-selection-companion native shell");
}
