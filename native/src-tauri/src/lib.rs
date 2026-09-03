pub mod bridge;
pub mod protocol;

pub fn run() {
    tauri::Builder::default()
        .manage(bridge::BridgeRuntime::from_environment())
        .invoke_handler(tauri::generate_handler![
            bridge::bridge_status,
            bridge::bridge_connect,
            bridge::bridge_ping,
            bridge::bridge_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run dsh-selection-companion native shell");
}
