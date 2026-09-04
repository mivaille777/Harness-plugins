pub mod bridge;
pub mod capture;
pub mod native_messaging;
pub mod protocol;
pub mod providers;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(bridge::BridgeRuntime::from_environment())
        .setup(|app| {
            let capture = capture::CaptureRuntime::start(app.handle().clone());
            app.manage(capture);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_status,
            bridge::bridge_connect,
            bridge::bridge_ping,
            bridge::bridge_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run dsh-selection-companion native shell");
}
