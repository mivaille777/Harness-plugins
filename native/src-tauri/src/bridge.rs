use serde::Serialize;
#[cfg(windows)]
use std::collections::HashMap;
use std::env;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::State;
#[cfg(windows)]
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

const DEFAULT_BRIDGE_REQUEST_TIMEOUT_MS: u64 = 5_000;

use crate::protocol::{
    BridgeHelloResultPayload, IpcMessage, SelectionCurrentResultPayload, SelectionSnapshot,
    IPC_FRAME_HEADER_BYTES, IPC_MAX_FRAME_BYTES, IPC_PROTOCOL_VERSION,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSubmission {
    pub session_id: String,
    pub request_id: String,
    pub message_id: String,
    pub delivery: String,
    pub duplicate: bool,
}

pub const DEFAULT_PIPE_NAME: &str = r"\\.\pipe\dsh-selection-companion-v2";

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
    request_timeout: std::time::Duration,
    inner: Mutex<BridgeInner>,
}

struct BridgeInner {
    connected: bool,
    server_version: Option<String>,
    last_error: Option<String>,
    last_latency_ms: Option<u64>,
    #[cfg(windows)]
    client: Option<tokio::net::windows::named_pipe::NamedPipeClient>,
    #[cfg(windows)]
    subscriptions: HashMap<String, SubscriptionTask>,
    #[cfg(windows)]
    subscription_epoch: u64,
}

#[cfg(windows)]
struct SubscriptionTask {
    id: String,
    handle: tokio::task::JoinHandle<()>,
}

impl BridgeRuntime {
    pub fn from_environment() -> Result<Self, String> {
        let endpoint = env::var("DSH_SELECTION_COMPANION_PIPE")
            .unwrap_or_else(|_| DEFAULT_PIPE_NAME.to_owned());
        let request_timeout = env::var("DSH_SELECTION_BRIDGE_TIMEOUT_MS")
            .ok()
            .map(|value| value.parse::<u64>())
            .transpose()
            .map_err(|_| "DSH_SELECTION_BRIDGE_TIMEOUT_MS must be a positive integer".to_owned())?
            .unwrap_or(DEFAULT_BRIDGE_REQUEST_TIMEOUT_MS);
        if request_timeout == 0 || request_timeout > 60_000 {
            return Err(
                "DSH_SELECTION_BRIDGE_TIMEOUT_MS must be an integer from 1 to 60000".to_owned(),
            );
        }
        Ok(Self {
            endpoint,
            request_timeout: std::time::Duration::from_millis(request_timeout),
            inner: Mutex::new(BridgeInner {
                connected: false,
                server_version: None,
                last_error: None,
                last_latency_ms: None,
                #[cfg(windows)]
                client: None,
                #[cfg(windows)]
                subscriptions: HashMap::new(),
                #[cfg(windows)]
                subscription_epoch: 0,
            }),
        })
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

        let response = exchange(&mut client, &hello, self.request_timeout)
            .await
            .map_err(|error| {
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

    /// Starts a dedicated pipe reader for a session event stream.
    ///
    /// The request/reply pipe remains exclusively owned by `BridgeInner::client`.
    #[cfg(windows)]
    async fn subscribe_session(
        &self,
        app: AppHandle,
        session_id: String,
        subscription_id: String,
        cursor: Option<u64>,
    ) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;
        use tokio::net::windows::named_pipe::ClientOptions;
        use tokio::time::{sleep, timeout, Duration};

        if session_id.trim().is_empty() {
            return Err("session id must not be empty".to_owned());
        }
        if subscription_id.trim().is_empty() {
            return Err("subscription id must not be empty".to_owned());
        }
        let epoch = self.inner.lock().await.subscription_epoch;

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
            return Err(format!(
                "cannot open session event pipe {}: {}",
                self.endpoint,
                last_error.unwrap_or_else(|| "unknown error".to_owned())
            ));
        };

        let hello_id = request_id("subscription-hello");
        let hello = bridge_hello(hello_id.clone());
        let response = exchange(&mut client, &hello, self.request_timeout).await?;
        ensure_response_id(&response, &hello_id)?;
        ensure_hello_response(response)?;

        let subscribe_id = subscription_id.clone();
        let payload = match cursor {
            Some(cursor) => serde_json::json!({ "sessionId": session_id, "cursor": cursor }),
            None => serde_json::json!({ "sessionId": session_id }),
        };
        let subscribe = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: subscribe_id.clone(),
            type_name: "session.subscribe".to_owned(),
            payload,
        };
        let frame = crate::protocol::encode_frame(&subscribe).map_err(|error| error.to_string())?;
        timeout(self.request_timeout, async {
            client
                .write_all(&frame)
                .await
                .map_err(|error| error.to_string())?;
            client.flush().await.map_err(|error| error.to_string())
        })
        .await
        .map_err(|_| {
            format!(
                "session subscription timed out after {} ms",
                self.request_timeout.as_millis()
            )
        })??;

        let subscribed = read_message(&mut client, self.request_timeout).await?;
        ensure_response_id(&subscribed, &subscribe_id)?;
        if subscribed.type_name == "error.response" {
            return Err(format!(
                "Harness rejected session subscription: {}",
                subscribed.payload
            ));
        }
        if subscribed.type_name != "session.subscribed" {
            return Err(format!(
                "unexpected session.subscribe response: {}",
                subscribed.type_name
            ));
        }
        let acknowledged_id = subscribed
            .payload
            .get("subscriptionId")
            .and_then(serde_json::Value::as_str);
        if acknowledged_id != Some(subscription_id.as_str()) {
            return Err("session.subscribed response has a different subscriptionId".to_owned());
        }

        let expected_session_id = session_id.clone();
        let expected_subscription_id = subscription_id.clone();
        let cleanup_app = app.clone();
        let (start_tx, start_rx) = tokio::sync::oneshot::channel::<()>();
        let task = tokio::spawn(async move {
            if start_rx.await.is_err() {
                return;
            }
            loop {
                match read_message_unbounded(&mut client).await {
                    Ok(message) if message.type_name == "agent.event" => {
                        let matches_session = message
                            .payload
                            .get("sessionId")
                            .and_then(serde_json::Value::as_str)
                            == Some(expected_session_id.as_str());
                        if !matches_session {
                            let _ = app.emit(
                                "session-agent-event",
                                serde_json::json!({
                                    "sessionId": expected_session_id,
                                    "subscriptionId": expected_subscription_id,
                                    "error": "received event for a different session",
                                }),
                            );
                            break;
                        }
                        let _ = app.emit("session-agent-event", message.payload);
                    }
                    Ok(message) => {
                        let _ = app.emit(
                            "session-agent-event",
                            serde_json::json!({
                                "sessionId": expected_session_id,
                                "subscriptionId": expected_subscription_id,
                                "error": format!("unexpected subscription frame: {}", message.type_name),
                            }),
                        );
                        break;
                    }
                    Err(error) => {
                        let _ = app.emit(
                            "session-agent-event",
                            serde_json::json!({
                                "sessionId": expected_session_id,
                                "subscriptionId": expected_subscription_id,
                                "error": error,
                            }),
                        );
                        break;
                    }
                }
            }
            let runtime = cleanup_app.state::<BridgeRuntime>();
            runtime
                .remove_subscription(&expected_session_id, &expected_subscription_id)
                .await;
        });

        let mut inner = self.inner.lock().await;
        if inner.subscription_epoch != epoch {
            task.abort();
            return Err(
                "bridge disconnected while the session subscription was opening".to_owned(),
            );
        }
        if let Some(previous) = inner.subscriptions.insert(
            session_id,
            SubscriptionTask {
                id: subscription_id,
                handle: task,
            },
        ) {
            previous.handle.abort();
        }
        let _ = start_tx.send(());
        Ok(())
    }

    #[cfg(windows)]
    async fn remove_subscription(&self, session_id: &str, subscription_id: &str) {
        let mut inner = self.inner.lock().await;
        let matches = inner
            .subscriptions
            .get(session_id)
            .is_some_and(|subscription| subscription.id == subscription_id);
        if matches {
            inner.subscriptions.remove(session_id);
        }
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
            exchange(client, &ping, self.request_timeout).await
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
            exchange(client, &message, self.request_timeout).await
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

    #[cfg(windows)]
    async fn current_selection(&self) -> Result<Option<SelectionSnapshot>, String> {
        self.connect().await?;
        let request_id = request_id("selection-current");
        let message = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "selection.current".to_owned(),
            payload: serde_json::json!({}),
        };
        let mut inner = self.inner.lock().await;
        let client = inner
            .client
            .as_mut()
            .ok_or_else(|| "bridge is not connected".to_owned())?;
        let response = exchange(client, &message, self.request_timeout).await?;
        ensure_response_id(&response, &request_id)?;
        if response.type_name != "selection.current.result" {
            return Err(format!(
                "unexpected selection.current response: {}",
                response.type_name
            ));
        }
        let payload: SelectionCurrentResultPayload = serde_json::from_value(response.payload)
            .map_err(|error| format!("invalid selection.current payload: {error}"))?;
        Ok(payload.snapshot)
    }

    #[cfg(windows)]
    async fn submit_prompt(
        &self,
        session_id: Option<String>,
        content: String,
        logical_request_id: String,
    ) -> Result<SessionSubmission, String> {
        if content.trim().is_empty() {
            return Err("session prompt must not be empty".to_owned());
        }
        if logical_request_id.trim().is_empty() {
            return Err("logical request id must not be empty".to_owned());
        }
        self.connect().await?;
        let mut inner = self.inner.lock().await;
        let client = inner
            .client
            .as_mut()
            .ok_or_else(|| "bridge is not connected".to_owned())?;
        let session_id = match session_id {
            Some(id) => id,
            None => {
                let id = request_id("session-create");
                let create = IpcMessage {
                    protocol: IPC_PROTOCOL_VERSION,
                    id: id.clone(),
                    type_name: "session.create".to_owned(),
                    payload: serde_json::json!({}),
                };
                let response = exchange(client, &create, self.request_timeout).await?;
                ensure_response_id(&response, &id)?;
                if response.type_name == "error.response" {
                    return Err(format!(
                        "Harness rejected session creation: {}",
                        response.payload
                    ));
                }
                if response.type_name != "session.created" {
                    return Err(format!(
                        "unexpected session.create response: {}",
                        response.type_name
                    ));
                }
                response
                    .payload
                    .get("sessionId")
                    .and_then(serde_json::Value::as_str)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
                    .ok_or_else(|| "session.created response has no sessionId".to_owned())?
            }
        };
        let transport_id = request_id("session-submit");
        let submit = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: transport_id.clone(),
            type_name: "session.submit".to_owned(),
            payload: serde_json::json!({
                "sessionId": session_id,
                "requestId": logical_request_id,
                "mode": "queue",
                "content": [{ "type": "text", "text": content }]
            }),
        };
        let response = match exchange(client, &submit, self.request_timeout).await {
            Ok(response) => response,
            Err(error) => {
                return Err(mark_submission_unknown(
                    &mut inner,
                    &session_id,
                    &logical_request_id,
                    error,
                ));
            }
        };
        if let Err(error) = ensure_response_id(&response, &transport_id) {
            return Err(mark_submission_unknown(
                &mut inner,
                &session_id,
                &logical_request_id,
                error,
            ));
        }
        if response.type_name == "error.response" {
            return Err(format!(
                "Harness rejected session submission: {}",
                response.payload
            ));
        }
        if response.type_name != "session.submitted" {
            let error = format!("unexpected session.submit response: {}", response.type_name);
            return Err(mark_submission_unknown(
                &mut inner,
                &session_id,
                &logical_request_id,
                error,
            ));
        }
        let submitted: crate::protocol::SessionSubmittedPayload =
            match serde_json::from_value(response.payload) {
                Ok(submitted) => submitted,
                Err(error) => {
                    return Err(mark_submission_unknown(
                        &mut inner,
                        &session_id,
                        &logical_request_id,
                        format!("invalid session.submitted payload: {error}"),
                    ));
                }
            };
        if submitted.request_id != logical_request_id {
            return Err(mark_submission_unknown(
                &mut inner,
                &session_id,
                &logical_request_id,
                "session.submitted response has a different requestId",
            ));
        }
        Ok(SessionSubmission {
            session_id,
            request_id: submitted.request_id,
            message_id: submitted.message_id,
            delivery: match submitted.delivery {
                crate::protocol::SessionDeliveryReceipt::Queued => "queued".to_owned(),
                crate::protocol::SessionDeliveryReceipt::Steered => "steered".to_owned(),
            },
            duplicate: submitted.duplicate,
        })
    }

    #[cfg(windows)]
    async fn cancel_session(&self, session_id: String) -> Result<bool, String> {
        if session_id.trim().is_empty() {
            return Err("session id must not be empty".to_owned());
        }
        self.connect().await?;
        let request_id = request_id("session-cancel");
        let message = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "session.cancel".to_owned(),
            payload: serde_json::json!({ "sessionId": session_id }),
        };
        let mut inner = self.inner.lock().await;
        let client = inner
            .client
            .as_mut()
            .ok_or_else(|| "bridge is not connected".to_owned())?;
        let response = exchange(client, &message, self.request_timeout).await?;
        ensure_response_id(&response, &request_id)?;
        if response.type_name == "error.response" {
            return Err(format!(
                "Harness rejected session cancellation: {}",
                response.payload
            ));
        }
        if response.type_name != "session.cancelled" {
            return Err(format!(
                "unexpected session.cancel response: {}",
                response.type_name
            ));
        }
        response
            .payload
            .get("cancelled")
            .and_then(serde_json::Value::as_bool)
            .ok_or_else(|| "session.cancelled response has no cancelled flag".to_owned())
    }

    #[cfg(not(windows))]
    async fn submit_prompt(
        &self,
        _session_id: Option<String>,
        _content: String,
        _logical_request_id: String,
    ) -> Result<SessionSubmission, String> {
        self.connect().await?;
        unreachable!()
    }

    #[cfg(not(windows))]
    async fn cancel_session(&self, _session_id: String) -> Result<bool, String> {
        self.connect().await?;
        unreachable!()
    }

    #[cfg(not(windows))]
    async fn current_selection(&self) -> Result<Option<SelectionSnapshot>, String> {
        self.connect().await?;
        Ok(None)
    }

    async fn disconnect(&self) {
        let mut inner = self.inner.lock().await;
        inner.connected = false;
        inner.server_version = None;
        inner.last_error = None;
        #[cfg(windows)]
        {
            inner.client = None;
            inner.subscription_epoch = inner.subscription_epoch.wrapping_add(1);
            for (_, subscription) in inner.subscriptions.drain() {
                subscription.handle.abort();
            }
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

#[tauri::command]
pub async fn bridge_current_selection(
    state: State<'_, BridgeRuntime>,
) -> Result<Option<SelectionSnapshot>, String> {
    state.current_selection().await
}

#[tauri::command]
pub async fn bridge_submit_prompt(
    state: State<'_, BridgeRuntime>,
    session_id: Option<String>,
    content: String,
    request_id: String,
) -> Result<SessionSubmission, String> {
    state.submit_prompt(session_id, content, request_id).await
}

#[cfg(windows)]
#[tauri::command]
pub async fn bridge_subscribe_session(
    state: State<'_, BridgeRuntime>,
    app: AppHandle,
    session_id: String,
    subscription_id: String,
    cursor: Option<u64>,
) -> Result<(), String> {
    state
        .subscribe_session(app, session_id, subscription_id, cursor)
        .await
}

#[tauri::command]
pub async fn bridge_cancel_session(
    state: State<'_, BridgeRuntime>,
    session_id: String,
) -> Result<bool, String> {
    state.cancel_session(session_id).await
}

#[cfg(windows)]
async fn exchange(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
    message: &IpcMessage,
    request_timeout: std::time::Duration,
) -> Result<IpcMessage, String> {
    use tokio::io::AsyncWriteExt;
    use tokio::time::timeout;

    let frame = crate::protocol::encode_frame(message).map_err(|error| error.to_string())?;
    timeout(request_timeout, async {
        client
            .write_all(&frame)
            .await
            .map_err(|error| error.to_string())?;
        client.flush().await.map_err(|error| error.to_string())?;

        read_message_unbounded(client).await
    })
    .await
    .map_err(|_| {
        format!(
            "bridge request timed out after {} ms",
            request_timeout.as_millis()
        )
    })?
}

#[cfg(windows)]
async fn read_message(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
    request_timeout: std::time::Duration,
) -> Result<IpcMessage, String> {
    use tokio::time::timeout;

    timeout(request_timeout, read_message_unbounded(client))
        .await
        .map_err(|_| {
            format!(
                "bridge request timed out after {} ms",
                request_timeout.as_millis()
            )
        })?
}

#[cfg(windows)]
async fn read_message_unbounded(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
) -> Result<IpcMessage, String> {
    use tokio::io::AsyncReadExt;

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

#[cfg(windows)]
fn bridge_hello(id: String) -> IpcMessage {
    IpcMessage {
        protocol: IPC_PROTOCOL_VERSION,
        id,
        type_name: "bridge.hello".to_owned(),
        payload: serde_json::json!({
            "client": {
                "name": "dsh-selection-companion-native",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": "windows"
            },
            "supportedProtocols": [IPC_PROTOCOL_VERSION]
        }),
    }
}

#[cfg(windows)]
fn ensure_hello_response(response: IpcMessage) -> Result<BridgeHelloResultPayload, String> {
    if response.type_name == "error.response" {
        return Err(format!(
            "Harness rejected bridge hello: {}",
            response.payload
        ));
    }
    if response.type_name != "bridge.hello.result" {
        return Err(format!(
            "unexpected bridge hello response: {}",
            response.type_name
        ));
    }
    let result: BridgeHelloResultPayload = serde_json::from_value(response.payload)
        .map_err(|error| format!("invalid bridge hello payload: {error}"))?;
    if result.protocol != IPC_PROTOCOL_VERSION {
        return Err(format!(
            "Harness selected protocol {}, expected {}",
            result.protocol, IPC_PROTOCOL_VERSION
        ));
    }
    Ok(result)
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

#[cfg(windows)]
fn mark_submission_unknown(
    inner: &mut BridgeInner,
    session_id: &str,
    logical_request_id: &str,
    error: impl std::fmt::Display,
) -> String {
    let detail = error.to_string();
    inner.connected = false;
    inner.client = None;
    inner.last_error = Some(detail.clone());
    format!("SUBMISSION_UNKNOWN|{session_id}|{logical_request_id}|{detail}")
}

fn request_id(prefix: &str) -> String {
    format!("native-{prefix}-{}", uuid::Uuid::new_v4())
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
        assert_eq!(DEFAULT_PIPE_NAME, r"\\.\pipe\dsh-selection-companion-v2");
    }

    #[test]
    fn request_ids_do_not_depend_on_clock_resolution() {
        assert_ne!(request_id("submit"), request_id("submit"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn reports_unknown_after_submit_frame_is_written_and_reply_disconnects() {
        use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
        use tokio::net::windows::named_pipe::ServerOptions;

        async fn read_frame(reader: &mut (impl AsyncRead + Unpin)) -> IpcMessage {
            let mut header = [0_u8; IPC_FRAME_HEADER_BYTES];
            reader.read_exact(&mut header).await.unwrap();
            let declared = u32::from_be_bytes(header) as usize;
            let mut body = vec![0_u8; declared];
            reader.read_exact(&mut body).await.unwrap();
            let mut frame = Vec::with_capacity(IPC_FRAME_HEADER_BYTES + declared);
            frame.extend_from_slice(&header);
            frame.extend_from_slice(&body);
            crate::protocol::decode_frame(&frame).unwrap()
        }

        async fn write_frame(writer: &mut (impl AsyncWrite + Unpin), message: &IpcMessage) {
            let frame = crate::protocol::encode_frame(message).unwrap();
            writer.write_all(&frame).await.unwrap();
            writer.flush().await.unwrap();
        }

        let endpoint = format!(
            r"\\.\pipe\dsh-selection-companion-unknown-{}",
            uuid::Uuid::new_v4()
        );
        let mut server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&endpoint)
            .unwrap();
        let server_task = tokio::spawn(async move {
            server.connect().await.unwrap();
            let hello = read_frame(&mut server).await;
            write_frame(
                &mut server,
                &IpcMessage {
                    protocol: IPC_PROTOCOL_VERSION,
                    id: hello.id,
                    type_name: "bridge.hello.result".to_owned(),
                    payload: serde_json::json!({
                        "protocol": IPC_PROTOCOL_VERSION,
                        "server": { "name": "submit-unknown-test", "version": "0.1.0" },
                        "capabilities": ["session"]
                    }),
                },
            )
            .await;
            read_frame(&mut server).await
        });
        let runtime = BridgeRuntime {
            endpoint,
            request_timeout: std::time::Duration::from_secs(2),
            inner: Mutex::new(BridgeInner {
                connected: false,
                server_version: None,
                last_error: None,
                last_latency_ms: None,
                client: None,
                subscriptions: HashMap::new(),
                subscription_epoch: 0,
            }),
        };

        let failure = runtime
            .submit_prompt(
                Some("session-unknown".to_owned()),
                "fixed prompt".to_owned(),
                "request-unknown".to_owned(),
            )
            .await
            .unwrap_err();
        let submitted = server_task.await.unwrap();

        assert_eq!(submitted.type_name, "session.submit");
        assert_eq!(
            submitted
                .payload
                .get("requestId")
                .and_then(serde_json::Value::as_str),
            Some("request-unknown")
        );
        assert!(failure.starts_with("SUBMISSION_UNKNOWN|session-unknown|request-unknown|"));
        assert!(!runtime.status().await.connected);
    }

    #[tokio::test]
    async fn initial_status_is_disconnected() {
        let runtime = BridgeRuntime::from_environment().unwrap();
        let status = runtime.status().await;
        assert!(!status.connected);
        assert_eq!(status.protocol, IPC_PROTOCOL_VERSION);
        assert!(status.server_version.is_none());
    }

    #[test]
    fn rejects_invalid_request_timeout_configuration() {
        let previous = env::var("DSH_SELECTION_BRIDGE_TIMEOUT_MS").ok();
        env::set_var("DSH_SELECTION_BRIDGE_TIMEOUT_MS", "0");
        assert!(BridgeRuntime::from_environment().is_err());
        if let Some(previous) = previous {
            env::set_var("DSH_SELECTION_BRIDGE_TIMEOUT_MS", previous);
        } else {
            env::remove_var("DSH_SELECTION_BRIDGE_TIMEOUT_MS");
        }
    }
}
