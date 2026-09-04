use serde::Serialize;
use std::env;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::sync::Mutex;

use crate::protocol::{
    BridgeHelloResultPayload, IpcMessage, SelectionSnapshot, IPC_FRAME_HEADER_BYTES,
    IPC_MAX_FRAME_BYTES, IPC_PROTOCOL_VERSION,
};

pub const DEFAULT_PIPE_NAME: &str = r"\\.\pipe\dsh-selection-companion-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub connected: bool,
    pub endpoint: String,
    pub protocol: u32,
    pub server_version: Option<String>,
    pub last_error: Option<String>,
    pub last_latency_ms: Option<u64>,
}

pub struct BridgeRuntime {
    endpoint: String,
    inner: Mutex<BridgeInner>,
}

struct BridgeInner {
    connected: bool,
    server_version: Option<String>,
    last_error: Option<String>,
    last_latency_ms: Option<u64>,
    #[cfg(windows)]
    client: Option<tokio::net::windows::named_pipe::NamedPipeClient>,
}

impl BridgeRuntime {
    pub fn from_environment() -> Self {
        let endpoint = env::var("DSH_SELECTION_COMPANION_PIPE")
            .unwrap_or_else(|_| DEFAULT_PIPE_NAME.to_owned());
        Self {
            endpoint,
            inner: Mutex::new(BridgeInner {
                connected: false,
                server_version: None,
                last_error: None,
                last_latency_ms: None,
                #[cfg(windows)]
                client: None,
            }),
        }
    }

    async fn status(&self) -> BridgeStatus {
        let inner = self.inner.lock().await;
        BridgeStatus {
            connected: inner.connected,
            endpoint: self.endpoint.clone(),
            protocol: IPC_PROTOCOL_VERSION,
            server_version: inner.server_version.clone(),
            last_error: inner.last_error.clone(),
            last_latency_ms: inner.last_latency_ms,
        }
    }

    #[cfg(windows)]
    async fn connect(&self) -> Result<(), String> {
        use tokio::net::windows::named_pipe::ClientOptions;
        use tokio::time::{sleep, Duration};

        let mut inner = self.inner.lock().await;
        if inner.connected && inner.client.is_some() {
            return Ok(());
        }

        let mut last_error = None;
        let mut client = None;
        for attempt in 0..20 {
            match ClientOptions::new().open(&self.endpoint) {
                Ok(opened) => {
                    client = Some(opened);
                    break;
                }
                Err(error) => {
                    last_error = Some(error.to_string());
                    let retryable = matches!(error.raw_os_error(), Some(2 | 231));
                    if !retryable || attempt == 19 {
                        break;
                    }
                    sleep(Duration::from_millis(50)).await;
                }
            }
        }

        let Some(mut client) = client else {
            let message = format!(
                "cannot connect to Harness named pipe {}: {}",
                self.endpoint,
                last_error.unwrap_or_else(|| "unknown error".to_owned())
            );
            inner.connected = false;
            inner.last_error = Some(message.clone());
            return Err(message);
        };

        let request_id = request_id("hello");
        let hello = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "bridge.hello".to_owned(),
            payload: serde_json::json!({
                "client": {
                    "name": "dsh-selection-companion-native",
                    "version": env!("CARGO_PKG_VERSION"),
                    "platform": "windows"
                },
                "supportedProtocols": [IPC_PROTOCOL_VERSION]
            }),
        };

        let response = exchange(&mut client, &hello).await.map_err(|error| {
            let message = format!("bridge hello failed: {error}");
            inner.last_error = Some(message.clone());
            message
        })?;
        ensure_response_id(&response, &request_id)?;
        if response.type_name == "error.response" {
            let message = format!("Harness rejected bridge hello: {}", response.payload);
            inner.last_error = Some(message.clone());
            return Err(message);
        }
        if response.type_name != "bridge.hello.result" {
            let message = format!("unexpected bridge hello response: {}", response.type_name);
            inner.last_error = Some(message.clone());
            return Err(message);
        }

        let hello_result: BridgeHelloResultPayload = serde_json::from_value(response.payload)
            .map_err(|error| format!("invalid bridge hello payload: {error}"))?;
        if hello_result.protocol != IPC_PROTOCOL_VERSION {
            let message = format!(
                "Harness selected protocol {}, expected {}",
                hello_result.protocol, IPC_PROTOCOL_VERSION
            );
            inner.last_error = Some(message.clone());
            return Err(message);
        }

        inner.connected = true;
        inner.server_version = Some(hello_result.server.version);
        inner.last_error = None;
        inner.client = Some(client);
        Ok(())
    }

    #[cfg(not(windows))]
    async fn connect(&self) -> Result<(), String> {
        let message = "Selection Companion native bridge is Windows-only".to_owned();
        let mut inner = self.inner.lock().await;
        inner.connected = false;
        inner.last_error = Some(message.clone());
        Err(message)
    }

    #[cfg(windows)]
    async fn ping(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        if !inner.connected || inner.client.is_none() {
            let message = "bridge is not connected".to_owned();
            inner.last_error = Some(message.clone());
            return Err(message);
        }

        let sent_at = now_millis();
        let request_id = request_id("ping");
        let ping = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "bridge.ping".to_owned(),
            payload: serde_json::json!({ "sentAt": sent_at }),
        };
        let started = Instant::now();
        let result = {
            let client = inner.client.as_mut().expect("connected client");
            exchange(client, &ping).await
        };

        match result {
            Ok(response) => {
                ensure_response_id(&response, &request_id)?;
                if response.type_name != "bridge.pong" {
                    let message = format!("unexpected ping response: {}", response.type_name);
                    inner.last_error = Some(message.clone());
                    return Err(message);
                }
                inner.last_latency_ms = Some(started.elapsed().as_millis() as u64);
                inner.last_error = None;
                Ok(())
            }
            Err(error) => {
                let message = format!("bridge ping failed: {error}");
                inner.connected = false;
                inner.client = None;
                inner.last_error = Some(message.clone());
                Err(message)
            }
        }
    }

    #[cfg(not(windows))]
    async fn ping(&self) -> Result<(), String> {
        self.connect().await
    }

    #[cfg(windows)]
    pub async fn submit_selection(&self, snapshot: SelectionSnapshot) -> Result<(), String> {
        snapshot.validate().map_err(|error| error.to_string())?;
        self.connect().await?;

        let request_id = request_id("selection");
        let message = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "selection.update".to_owned(),
            payload: serde_json::json!({ "snapshot": snapshot }),
        };

        let mut inner = self.inner.lock().await;
        if !inner.connected || inner.client.is_none() {
            let message = "bridge is not connected".to_owned();
            inner.last_error = Some(message.clone());
            return Err(message);
        }

        let result = {
            let client = inner.client.as_mut().expect("connected client");
            exchange(client, &message).await
        };

        match result {
            Ok(response) => {
                if let Err(error) = ensure_response_id(&response, &request_id) {
                    inner.last_error = Some(error.clone());
                    return Err(error);
                }
                if response.type_name == "error.response" {
                    let error = format!("Harness rejected selection update: {}", response.payload);
                    inner.last_error = Some(error.clone());
                    return Err(error);
                }
                if response.type_name != "selection.updated" {
                    let error = format!(
                        "unexpected selection update response: {}",
                        response.type_name
                    );
                    inner.last_error = Some(error.clone());
                    return Err(error);
                }
                inner.last_error = None;
                Ok(())
            }
            Err(error) => {
                let message = format!("selection update failed: {error}");
                inner.connected = false;
                inner.client = None;
                inner.last_error = Some(message.clone());
                Err(message)
            }
        }
    }

    #[cfg(not(windows))]
    pub async fn submit_selection(&self, _snapshot: SelectionSnapshot) -> Result<(), String> {
        self.connect().await
    }

    async fn disconnect(&self) {
        let mut inner = self.inner.lock().await;
        inner.connected = false;
        inner.server_version = None;
        inner.last_error = None;
        #[cfg(windows)]
        {
            inner.client = None;
        }
    }
}

#[tauri::command]
pub async fn bridge_status(state: State<'_, BridgeRuntime>) -> Result<BridgeStatus, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn bridge_connect(state: State<'_, BridgeRuntime>) -> Result<BridgeStatus, String> {
    state.connect().await?;
    Ok(state.status().await)
}

#[tauri::command]
pub async fn bridge_ping(state: State<'_, BridgeRuntime>) -> Result<BridgeStatus, String> {
    state.ping().await?;
    Ok(state.status().await)
}

#[tauri::command]
pub async fn bridge_disconnect(state: State<'_, BridgeRuntime>) -> Result<BridgeStatus, String> {
    state.disconnect().await;
    Ok(state.status().await)
}

#[cfg(windows)]
async fn exchange(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
    message: &IpcMessage,
) -> Result<IpcMessage, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let frame = crate::protocol::encode_frame(message).map_err(|error| error.to_string())?;
    client
        .write_all(&frame)
        .await
        .map_err(|error| error.to_string())?;
    client.flush().await.map_err(|error| error.to_string())?;

    let mut header = [0_u8; IPC_FRAME_HEADER_BYTES];
    client
        .read_exact(&mut header)
        .await
        .map_err(|error| error.to_string())?;
    let declared = u32::from_be_bytes(header) as usize;
    if declared > IPC_MAX_FRAME_BYTES {
        return Err(format!(
            "Harness frame declares {declared} bytes; maximum is {IPC_MAX_FRAME_BYTES}"
        ));
    }

    let mut payload = vec![0_u8; declared];
    client
        .read_exact(&mut payload)
        .await
        .map_err(|error| error.to_string())?;
    let mut full_frame = Vec::with_capacity(IPC_FRAME_HEADER_BYTES + declared);
    full_frame.extend_from_slice(&header);
    full_frame.extend_from_slice(&payload);
    crate::protocol::decode_frame(&full_frame).map_err(|error| error.to_string())
}

fn ensure_response_id(response: &IpcMessage, request_id: &str) -> Result<(), String> {
    if response.id == request_id {
        return Ok(());
    }
    Err(format!(
        "response id mismatch: expected {request_id}, received {}",
        response.id
    ))
}

fn request_id(prefix: &str) -> String {
    format!("native-{prefix}-{}", now_millis())
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_pipe_matches_harness_transport() {
        assert_eq!(DEFAULT_PIPE_NAME, r"\\.\pipe\dsh-selection-companion-v1");
    }

    #[tokio::test]
    async fn initial_status_is_disconnected() {
        let runtime = BridgeRuntime::from_environment();
        let status = runtime.status().await;
        assert!(!status.connected);
        assert_eq!(status.protocol, IPC_PROTOCOL_VERSION);
        assert!(status.server_version.is_none());
    }
}
