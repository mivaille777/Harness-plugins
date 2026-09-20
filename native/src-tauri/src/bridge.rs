use serde::Serialize;
#[cfg(windows)]
use std::collections::HashMap;
use std::env;
#[cfg(windows)]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::State;
#[cfg(windows)]
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

const DEFAULT_BRIDGE_REQUEST_TIMEOUT_MS: u64 = 5_000;

use crate::protocol::{
    BridgeHelloResultPayload, IpcMessage, SelectionCurrentResultPayload, SelectionExpandedPayload,
    SelectionMaterial, SelectionSnapshot, SessionCreatedPayload, SessionHistoryResultPayload,
    SessionListResultPayload, IPC_FRAME_HEADER_BYTES, IPC_MAX_FRAME_BYTES, IPC_PROTOCOL_VERSION,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUnsubscription {
    pub session_id: String,
    pub subscription_id: String,
    pub released: bool,
}

pub const DEFAULT_PIPE_NAME: &str = r"\\.\pipe\dsh-selection-companion-v4";

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
    subscriptions: HashMap<String, SubscriptionSlot>,
    #[cfg(windows)]
    subscription_epoch: u64,
}

#[cfg(windows)]
enum SubscriptionSlot {
    Opening(OpeningSubscription),
    Active(ActiveSubscription),
}

#[cfg(windows)]
struct OpeningSubscription {
    id: String,
    generation: u64,
    cancelled: Arc<AtomicBool>,
}

#[cfg(windows)]
struct ActiveSubscription {
    id: String,
    generation: u64,
    handle: tokio::task::JoinHandle<()>,
}

#[cfg(windows)]
impl SubscriptionSlot {
    fn id(&self) -> &str {
        match self {
            Self::Opening(slot) => &slot.id,
            Self::Active(slot) => &slot.id,
        }
    }
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
        let cancelled = Arc::new(AtomicBool::new(false));
        let generation = {
            let mut inner = self.inner.lock().await;
            inner.subscription_epoch = inner.subscription_epoch.wrapping_add(1);
            let generation = inner.subscription_epoch;
            let previous = inner.subscriptions.insert(
                session_id.clone(),
                SubscriptionSlot::Opening(OpeningSubscription {
                    id: subscription_id.clone(),
                    generation,
                    cancelled: cancelled.clone(),
                }),
            );
            drop(inner);
            if let Some(previous) = previous {
                stop_subscription(previous).await;
            }
            generation
        };

        let result: Result<(), String> = async {
            let mut last_error = None;
            let mut client = None;
            for attempt in 0..20 {
                if cancelled.load(Ordering::Acquire) {
                    return Err("session subscription was cancelled while opening".to_owned());
                }
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
            if !self.subscription_opening_is_current(&session_id, &subscription_id, generation, &cancelled).await {
                return Err("session subscription was cancelled while opening".to_owned());
            }

            let hello_id = request_id("subscription-hello");
            let hello = bridge_hello(hello_id.clone());
            let response = exchange(&mut client, &hello, self.request_timeout).await?;
            ensure_response_id(&response, &hello_id)?;
            ensure_hello_response(response)?;
            if !self.subscription_opening_is_current(&session_id, &subscription_id, generation, &cancelled).await {
                return Err("session subscription was cancelled while opening".to_owned());
            }

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
                    .remove_subscription(&expected_session_id, &expected_subscription_id, generation)
                    .await;
            });

            if !self.promote_subscription(&session_id, &subscription_id, generation, &cancelled, task).await {
                return Err("session subscription was cancelled while opening".to_owned());
            }
            let _ = start_tx.send(());
            Ok(())
        }.await;

        if result.is_err() {
            self.clear_opening_subscription(&session_id, &subscription_id, generation)
                .await;
        }
        result
    }

    #[cfg(windows)]
    async fn subscription_opening_is_current(
        &self,
        session_id: &str,
        subscription_id: &str,
        generation: u64,
        cancelled: &Arc<AtomicBool>,
    ) -> bool {
        if cancelled.load(Ordering::Acquire) {
            return false;
        }
        let inner = self.inner.lock().await;
        matches!(
            inner.subscriptions.get(session_id),
            Some(SubscriptionSlot::Opening(slot))
                if slot.id == subscription_id
                    && slot.generation == generation
                    && !slot.cancelled.load(Ordering::Acquire)
        )
    }

    #[cfg(windows)]
    async fn promote_subscription(
        &self,
        session_id: &str,
        subscription_id: &str,
        generation: u64,
        cancelled: &Arc<AtomicBool>,
        task: tokio::task::JoinHandle<()>,
    ) -> bool {
        let mut inner = self.inner.lock().await;
        let current = matches!(
            inner.subscriptions.get(session_id),
            Some(SubscriptionSlot::Opening(slot))
                if slot.id == subscription_id
                    && slot.generation == generation
                    && Arc::ptr_eq(&slot.cancelled, cancelled)
                    && !slot.cancelled.load(Ordering::Acquire)
        );
        if current {
            inner.subscriptions.insert(
                session_id.to_owned(),
                SubscriptionSlot::Active(ActiveSubscription {
                    id: subscription_id.to_owned(),
                    generation,
                    handle: task,
                }),
            );
        }
        current
    }

    #[cfg(windows)]
    async fn clear_opening_subscription(
        &self,
        session_id: &str,
        subscription_id: &str,
        generation: u64,
    ) {
        let mut inner = self.inner.lock().await;
        let matches = matches!(
            inner.subscriptions.get(session_id),
            Some(SubscriptionSlot::Opening(slot))
                if slot.id == subscription_id && slot.generation == generation
        );
        if matches {
            inner.subscriptions.remove(session_id);
        }
    }

    #[cfg(windows)]
    async fn remove_subscription(&self, session_id: &str, subscription_id: &str, generation: u64) {
        let mut inner = self.inner.lock().await;
        let matches = matches!(
            inner.subscriptions.get(session_id),
            Some(SubscriptionSlot::Active(slot))
                if slot.id == subscription_id && slot.generation == generation
        );
        if matches {
            inner.subscriptions.remove(session_id);
        }
    }

    #[cfg(windows)]
    async fn unsubscribe_session(
        &self,
        session_id: String,
        subscription_id: String,
    ) -> Result<SessionUnsubscription, String> {
        if session_id.trim().is_empty() {
            return Err("session id must not be empty".to_owned());
        }
        if subscription_id.trim().is_empty() {
            return Err("subscription id must not be empty".to_owned());
        }
        let slot = {
            let mut inner = self.inner.lock().await;
            let matches = inner
                .subscriptions
                .get(&session_id)
                .is_some_and(|slot| slot.id() == subscription_id);
            if matches {
                inner.subscriptions.remove(&session_id)
            } else {
                None
            }
        };
        let released = slot.is_some();
        if let Some(slot) = slot {
            stop_subscription(slot).await;
        }
        Ok(SessionUnsubscription {
            session_id,
            subscription_id,
            released,
        })
    }

    #[cfg(not(windows))]
    async fn unsubscribe_session(
        &self,
        session_id: String,
        subscription_id: String,
    ) -> Result<SessionUnsubscription, String> {
        Ok(SessionUnsubscription {
            session_id,
            subscription_id,
            released: false,
        })
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

        // Keep one immutable request identity across a transport retry. A stale
        // named-pipe handle is expected after Harness' idle timeout or a Harness
        // restart; retrying the exact same selection.update is safe and avoids
        // silently replacing the user's captured snapshot.
        let request_id = request_id("selection");
        let message = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "selection.update".to_owned(),
            payload: serde_json::json!({ "snapshot": snapshot }),
        };

        let mut attempts = 0;
        let response = loop {
            let mut inner = self.inner.lock().await;
            let client = inner
                .client
                .as_mut()
                .ok_or_else(|| "bridge is not connected".to_owned())?;
            match exchange(client, &message, self.request_timeout).await {
                Ok(response) => break response,
                Err(error) => {
                    let detail = format!("selection update failed: {error}");
                    inner.connected = false;
                    inner.client = None;
                    inner.last_error = Some(detail.clone());
                    drop(inner);

                    attempts += 1;
                    if attempts >= 2 {
                        return Err(detail);
                    }

                    self.connect().await?;
                }
            }
        };

        let mut inner = self.inner.lock().await;
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
    async fn expand_selection(
        &self,
        snapshot_id: String,
        scope: String,
    ) -> Result<SelectionExpandedPayload, String> {
        if snapshot_id.trim().is_empty() {
            return Err("snapshot id must not be empty".to_owned());
        }
        if !matches!(scope.as_str(), "selection" | "local" | "section" | "page") {
            return Err("scope must be selection, local, section, or page".to_owned());
        }
        self.connect().await?;
        let request_id = request_id("selection-expand");
        let message = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "selection.expand".to_owned(),
            payload: serde_json::json!({ "snapshotId": snapshot_id, "scope": scope }),
        };
        let mut attempts = 0;
        let response = loop {
            let mut inner = self.inner.lock().await;
            let client = inner
                .client
                .as_mut()
                .ok_or_else(|| "bridge is not connected".to_owned())?;
            match exchange(client, &message, self.request_timeout).await {
                Ok(response) => break response,
                Err(error) => {
                    let detail = format!("selection expansion failed: {error}");
                    inner.connected = false;
                    inner.client = None;
                    inner.last_error = Some(detail.clone());
                    drop(inner);
                    attempts += 1;
                    if attempts < 2 {
                        self.connect().await?;
                        continue;
                    }
                    return Err(detail);
                }
            }
        };
        ensure_response_id(&response, &request_id)?;
        if response.type_name == "error.response" {
            return Err(format!(
                "Harness rejected selection expansion: {}",
                response.payload
            ));
        }
        if response.type_name != "selection.expanded" {
            return Err(format!(
                "unexpected selection.expand response: {}",
                response.type_name
            ));
        }
        let payload: SelectionExpandedPayload = serde_json::from_value(response.payload)
            .map_err(|error| format!("invalid selection.expanded payload: {error}"))?;
        self.inner.lock().await.last_error = None;
        Ok(payload)
    }

    #[cfg(windows)]
    async fn submit_prompt(
        &self,
        session_id: Option<String>,
        content: String,
        logical_request_id: String,
        material_snapshot: SelectionSnapshot,
    ) -> Result<SessionSubmission, String> {
        if content.trim().is_empty() {
            return Err("session prompt must not be empty".to_owned());
        }
        if logical_request_id.trim().is_empty() {
            return Err("logical request id must not be empty".to_owned());
        }
        material_snapshot
            .validate()
            .map_err(|error| error.to_string())?;
        let material = SelectionMaterial::from_snapshot(&material_snapshot);
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
                "content": [{ "type": "text", "text": content }],
                "material": material
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
        _material_snapshot: SelectionSnapshot,
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

    #[cfg(not(windows))]
    async fn expand_selection(
        &self,
        _snapshot_id: String,
        _scope: String,
    ) -> Result<SelectionExpandedPayload, String> {
        self.connect().await?;
        Err("selection expansion is only available on the Windows bridge".to_owned())
    }

    #[cfg(windows)]
    async fn list_sessions(&self) -> Result<Vec<crate::protocol::SessionSummary>, String> {
        self.connect().await?;
        let request_id = request_id("session-list");
        let message = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "session.list".to_owned(),
            payload: serde_json::json!({}),
        };
        let mut inner = self.inner.lock().await;
        let client = inner
            .client
            .as_mut()
            .ok_or_else(|| "bridge is not connected".to_owned())?;
        let response = match exchange(client, &message, self.request_timeout).await {
            Ok(response) => response,
            Err(error) => {
                let message = format!("session list failed: {error}");
                inner.connected = false;
                inner.client = None;
                inner.last_error = Some(message.clone());
                return Err(message);
            }
        };
        ensure_response_id(&response, &request_id)?;
        if response.type_name == "error.response" {
            return Err(format!(
                "Harness rejected session list: {}",
                response.payload
            ));
        }
        if response.type_name != "session.list.result" {
            return Err(format!(
                "unexpected session.list response: {}",
                response.type_name
            ));
        }
        let payload: SessionListResultPayload = serde_json::from_value(response.payload)
            .map_err(|error| format!("invalid session.list.result payload: {error}"))?;
        inner.last_error = None;
        Ok(payload.sessions)
    }

    #[cfg(not(windows))]
    async fn list_sessions(&self) -> Result<Vec<crate::protocol::SessionSummary>, String> {
        self.connect().await?;
        unreachable!()
    }

    #[cfg(windows)]
    async fn create_session(&self, cwd: Option<String>) -> Result<String, String> {
        if cwd.as_deref().is_some_and(|value| value.trim().is_empty()) {
            return Err("session cwd must not be empty".to_owned());
        }
        self.connect().await?;
        let request_id = request_id("session-create");
        let message = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "session.create".to_owned(),
            payload: match cwd {
                Some(cwd) => serde_json::json!({ "cwd": cwd }),
                None => serde_json::json!({}),
            },
        };
        let mut inner = self.inner.lock().await;
        let client = inner
            .client
            .as_mut()
            .ok_or_else(|| "bridge is not connected".to_owned())?;
        let response = match exchange(client, &message, self.request_timeout).await {
            Ok(response) => response,
            Err(error) => {
                let message = mark_create_unknown(&mut inner, &request_id, error);
                return Err(message);
            }
        };
        if let Err(error) = ensure_response_id(&response, &request_id) {
            return Err(mark_create_unknown(&mut inner, &request_id, error));
        }
        if response.type_name == "error.response" {
            return Err(format!(
                "Harness rejected session creation: {}",
                response.payload
            ));
        }
        if response.type_name != "session.created" {
            return Err(mark_create_unknown(
                &mut inner,
                &request_id,
                format!("unexpected session.create response: {}", response.type_name),
            ));
        }
        let payload: SessionCreatedPayload = match serde_json::from_value(response.payload) {
            Ok(payload) => payload,
            Err(error) => {
                return Err(mark_create_unknown(
                    &mut inner,
                    &request_id,
                    format!("invalid session.created payload: {error}"),
                ));
            }
        };
        inner.last_error = None;
        Ok(payload.session_id)
    }

    #[cfg(not(windows))]
    async fn create_session(&self, _cwd: Option<String>) -> Result<String, String> {
        self.connect().await?;
        unreachable!()
    }

    #[cfg(windows)]
    async fn read_session_history(
        &self,
        session_id: String,
        after_cursor: Option<u64>,
        limit: Option<u64>,
    ) -> Result<SessionHistoryResultPayload, String> {
        if session_id.trim().is_empty() {
            return Err("session id must not be empty".to_owned());
        }
        if after_cursor.is_some_and(|value| value > 9_007_199_254_740_991) {
            return Err("afterCursor must be a non-negative safe integer".to_owned());
        }
        if limit
            .is_some_and(|value| value == 0 || value > crate::protocol::MAX_HISTORY_PAGE_ENTRIES)
        {
            return Err(format!(
                "limit must be a positive safe integer no greater than {}",
                crate::protocol::MAX_HISTORY_PAGE_ENTRIES
            ));
        }
        self.connect().await?;
        let request_id = request_id("session-history");
        let expected_session_id = session_id.clone();
        let mut payload = serde_json::Map::new();
        payload.insert(
            "sessionId".to_owned(),
            serde_json::Value::String(session_id),
        );
        if let Some(after_cursor) = after_cursor {
            payload.insert("afterCursor".to_owned(), serde_json::json!(after_cursor));
        }
        if let Some(limit) = limit {
            payload.insert("limit".to_owned(), serde_json::json!(limit));
        }
        let message = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: request_id.clone(),
            type_name: "session.history".to_owned(),
            payload: serde_json::Value::Object(payload),
        };
        let mut inner = self.inner.lock().await;
        let client = inner
            .client
            .as_mut()
            .ok_or_else(|| "bridge is not connected".to_owned())?;
        let response = match exchange(client, &message, self.request_timeout).await {
            Ok(response) => response,
            Err(error) => {
                let message = format!("session history failed: {error}");
                inner.connected = false;
                inner.client = None;
                inner.last_error = Some(message.clone());
                return Err(message);
            }
        };
        ensure_response_id(&response, &request_id)?;
        if response.type_name == "error.response" {
            return Err(format!(
                "Harness rejected session history: {}",
                response.payload
            ));
        }
        if response.type_name != "session.history.result" {
            return Err(format!(
                "unexpected session.history response: {}",
                response.type_name
            ));
        }
        let payload: SessionHistoryResultPayload = serde_json::from_value(response.payload)
            .map_err(|error| format!("invalid session.history.result payload: {error}"))?;
        if payload.session_id.is_empty() || payload.session_id != expected_session_id {
            return Err("session.history.result response has a different sessionId".to_owned());
        }
        inner.last_error = None;
        Ok(payload)
    }

    #[cfg(not(windows))]
    async fn read_session_history(
        &self,
        _session_id: String,
        _after_cursor: Option<u64>,
        _limit: Option<u64>,
    ) -> Result<SessionHistoryResultPayload, String> {
        self.connect().await?;
        unreachable!()
    }

    async fn disconnect(&self) {
        #[cfg(windows)]
        let subscriptions = {
            let mut inner = self.inner.lock().await;
            inner.connected = false;
            inner.server_version = None;
            inner.last_error = None;
            inner.client = None;
            inner.subscription_epoch = inner.subscription_epoch.wrapping_add(1);
            inner
                .subscriptions
                .drain()
                .map(|(_, slot)| slot)
                .collect::<Vec<_>>()
        };
        #[cfg(windows)]
        for subscription in subscriptions {
            stop_subscription(subscription).await;
        }
        #[cfg(not(windows))]
        {
            let mut inner = self.inner.lock().await;
            inner.connected = false;
            inner.server_version = None;
            inner.last_error = None;
        }
    }
}

#[cfg(windows)]
async fn stop_subscription(slot: SubscriptionSlot) {
    match slot {
        SubscriptionSlot::Opening(opening) => {
            opening.cancelled.store(true, Ordering::Release);
        }
        SubscriptionSlot::Active(active) => {
            active.handle.abort();
            let _ = active.handle.await;
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
pub async fn bridge_expand_selection(
    state: State<'_, BridgeRuntime>,
    snapshot_id: String,
    scope: String,
) -> Result<SelectionExpandedPayload, String> {
    state.expand_selection(snapshot_id, scope).await
}

#[tauri::command]
pub async fn bridge_submit_prompt(
    state: State<'_, BridgeRuntime>,
    session_id: Option<String>,
    content: String,
    request_id: String,
    material: SelectionSnapshot,
) -> Result<SessionSubmission, String> {
    state
        .submit_prompt(session_id, content, request_id, material)
        .await
}

#[tauri::command]
pub async fn bridge_list_sessions(
    state: State<'_, BridgeRuntime>,
) -> Result<Vec<crate::protocol::SessionSummary>, String> {
    state.list_sessions().await
}

#[tauri::command]
pub async fn bridge_create_session(
    state: State<'_, BridgeRuntime>,
    cwd: Option<String>,
) -> Result<String, String> {
    state.create_session(cwd).await
}

#[tauri::command]
pub async fn bridge_read_session_history(
    state: State<'_, BridgeRuntime>,
    session_id: String,
    after_cursor: Option<u64>,
    limit: Option<u64>,
) -> Result<crate::protocol::SessionHistoryResultPayload, String> {
    state
        .read_session_history(session_id, after_cursor, limit)
        .await
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
pub async fn bridge_unsubscribe_session(
    state: State<'_, BridgeRuntime>,
    session_id: String,
    subscription_id: String,
) -> Result<SessionUnsubscription, String> {
    state.unsubscribe_session(session_id, subscription_id).await
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

#[cfg(windows)]
fn mark_create_unknown(
    inner: &mut BridgeInner,
    request_id: &str,
    error: impl std::fmt::Display,
) -> String {
    inner.connected = false;
    inner.client = None;
    let message = format!("CREATE_UNKNOWN|{request_id}|{error}");
    inner.last_error = Some(message.clone());
    message
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

    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn material_snapshot() -> SelectionSnapshot {
        serde_json::from_value(serde_json::json!({
            "id": "snapshot-submit",
            "revision": 1,
            "capturedAt": 1_000,
            "selection": { "text": "fixed selected material" },
            "source": { "kind": "browser", "app": "Chrome" },
            "document": { "title": "Fixed document", "url": "https://example.test/fixed" },
            "context": { "pageAvailable": false },
            "capabilities": {
                "localContext": false,
                "sectionContext": false,
                "pageContext": false,
                "screenshot": false
            },
            "provider": "test-provider",
            "confidence": 1.0
        }))
        .unwrap()
    }

    #[test]
    fn default_pipe_matches_harness_transport() {
        assert_eq!(DEFAULT_PIPE_NAME, r"\\.\pipe\dsh-selection-companion-v4");
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
                material_snapshot(),
            )
            .await
            .unwrap_err();
        let submitted = server_task.await.unwrap();

        assert_eq!(submitted.type_name, "session.submit");
        assert_eq!(submitted.protocol, IPC_PROTOCOL_VERSION);
        assert_eq!(IPC_PROTOCOL_VERSION, 4);
        assert_eq!(
            submitted.payload["material"],
            serde_json::json!({
                "snapshotId": "snapshot-submit",
                "revision": 1,
                "capturedAt": 1_000,
                "selection": { "text": "fixed selected material", "language": null },
                "source": {
                    "kind": "browser",
                    "app": "Chrome",
                    "process": null,
                    "windowTitle": null
                },
                "document": {
                    "title": "Fixed document",
                    "url": "https://example.test/fixed",
                    "filePath": null,
                    "section": null,
                    "frameUrl": null
                },
                "authorizedScope": "selection",
                "actualScope": "selection",
                "completeness": "complete"
            })
        );
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

    #[cfg(windows)]
    #[tokio::test]
    async fn selection_update_reconnects_after_harness_closes_an_idle_pipe() {
        use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
        use tokio::net::windows::named_pipe::ServerOptions;
        use tokio::sync::oneshot;

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

        fn hello_response(id: String) -> IpcMessage {
            IpcMessage {
                protocol: IPC_PROTOCOL_VERSION,
                id,
                type_name: "bridge.hello.result".to_owned(),
                payload: serde_json::json!({
                    "protocol": IPC_PROTOCOL_VERSION,
                    "server": { "name": "selection-reconnect-test", "version": "0.1.0" },
                    "capabilities": ["selection"]
                }),
            }
        }

        let endpoint = format!(
            r"\\.\pipe\dsh-selection-companion-selection-reconnect-{}",
            uuid::Uuid::new_v4()
        );
        let mut first_server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&endpoint)
            .unwrap();
        let second_endpoint = endpoint.clone();
        let (second_ready_tx, second_ready_rx) = oneshot::channel();

        let server_task = tokio::spawn(async move {
            first_server.connect().await.unwrap();
            let first_hello = read_frame(&mut first_server).await;
            write_frame(&mut first_server, &hello_response(first_hello.id)).await;

            // Reproduce Harness' idle-timeout behavior: the server side closes
            // while Native still retains its apparently connected client handle.
            drop(first_server);

            let mut second_server = ServerOptions::new().create(&second_endpoint).unwrap();
            let _ = second_ready_tx.send(());
            second_server.connect().await.unwrap();

            let second_hello = read_frame(&mut second_server).await;
            write_frame(&mut second_server, &hello_response(second_hello.id)).await;

            let update = read_frame(&mut second_server).await;
            write_frame(
                &mut second_server,
                &IpcMessage {
                    protocol: IPC_PROTOCOL_VERSION,
                    id: update.id.clone(),
                    type_name: "selection.updated".to_owned(),
                    payload: serde_json::json!({
                        "accepted": true,
                        "snapshotId": "snapshot-submit",
                        "revision": 1
                    }),
                },
            )
            .await;
            update
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

        runtime.connect().await.unwrap();
        second_ready_rx.await.unwrap();

        runtime.submit_selection(material_snapshot()).await.unwrap();
        let update = server_task.await.unwrap();

        assert_eq!(update.type_name, "selection.update");
        assert_eq!(update.payload["snapshot"]["id"], "snapshot-submit");
        let status = runtime.status().await;
        assert!(status.connected);
        assert!(status.last_error.is_none());
    }

    #[tokio::test]
    async fn initial_status_is_disconnected() {
        let runtime = {
            let _guard = ENV_LOCK.lock().unwrap();
            BridgeRuntime::from_environment().unwrap()
        };
        let status = runtime.status().await;
        assert!(!status.connected);
        assert_eq!(status.protocol, IPC_PROTOCOL_VERSION);
        assert!(status.server_version.is_none());
    }

    #[test]
    fn rejects_invalid_request_timeout_configuration() {
        let _guard = ENV_LOCK.lock().unwrap();
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
