use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::error::Error;
use std::fmt::{Display, Formatter};

pub const IPC_PROTOCOL_VERSION: u32 = 3;
pub const IPC_MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const IPC_FRAME_HEADER_BYTES: usize = 4;
pub const DEFAULT_IPC_REQUEST_TIMEOUT_MS: u64 = 30_000;
pub const MAX_HISTORY_PAGE_ENTRIES: u64 = 32;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const IPC_MESSAGE_TYPES: &[&str] = &[
    "bridge.hello",
    "bridge.hello.result",
    "bridge.ping",
    "bridge.pong",
    "selection.update",
    "selection.updated",
    "selection.current",
    "selection.current.result",
    "selection.expand",
    "selection.expanded",
    "session.list",
    "session.list.result",
    "session.history",
    "session.history.result",
    "session.create",
    "session.created",
    "session.submit",
    "session.submitted",
    "session.subscribe",
    "session.subscribed",
    "session.cancel",
    "session.cancelled",
    "agent.event",
    "error.response",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct IpcMessage {
    pub protocol: u32,
    pub id: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeHelloPayload {
    pub client: ClientInfo,
    pub supported_protocols: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
    pub platform: NativePlatform,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NativePlatform {
    Windows,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeHelloResultPayload {
    pub server: ServerInfo,
    pub protocol: u32,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EmptyPayload {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PingPayload {
    pub sent_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PongPayload {
    pub sent_at: u64,
    pub received_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SelectionUpdatePayload {
    pub snapshot: SelectionSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionUpdatedPayload {
    pub accepted: bool,
    pub snapshot_id: String,
    pub revision: u64,
    #[serde(default)]
    pub reason: Option<StaleRevisionReason>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum StaleRevisionReason {
    StaleRevision,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionCurrentResultPayload {
    pub snapshot: Option<SelectionSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionExpandPayload {
    pub snapshot_id: String,
    pub scope: ContextScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContextScope {
    Selection,
    Local,
    Section,
    Page,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionExpandedPayload {
    pub snapshot_id: String,
    pub scope: ContextScope,
    #[serde(default)]
    pub revision: Option<u64>,
    #[serde(default)]
    pub completeness: Option<SelectionContextCompleteness>,
    #[serde(default)]
    pub truncated: Option<bool>,
    pub context: ExpandedSelectionContext,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SelectionContextCompleteness {
    Complete,
    Partial,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpandedSelectionContext {
    #[serde(default)]
    pub before: Option<String>,
    #[serde(default)]
    pub after: Option<String>,
    #[serde(default)]
    pub section_text: Option<String>,
    #[serde(default)]
    pub page_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionSnapshot {
    pub id: String,
    pub revision: u64,
    pub captured_at: u64,
    pub selection: SelectionValue,
    pub source: SelectionSource,
    #[serde(default)]
    pub document: Option<SelectionDocument>,
    pub context: SelectionContext,
    pub capabilities: SelectionCapabilities,
    #[serde(default)]
    pub geometry: Option<SelectionGeometry>,
    pub provider: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SelectionValue {
    pub text: String,
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionSource {
    pub kind: SelectionSourceKind,
    #[serde(default)]
    pub app: Option<String>,
    #[serde(default)]
    pub process: Option<String>,
    #[serde(default)]
    pub window_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SelectionSourceKind {
    Browser,
    Pdf,
    Word,
    Desktop,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionDocument {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub frame_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionContext {
    #[serde(default)]
    pub before: Option<String>,
    #[serde(default)]
    pub after: Option<String>,
    #[serde(default)]
    pub section_text: Option<String>,
    #[serde(default)]
    pub page_text: Option<String>,
    pub page_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionCapabilities {
    pub local_context: bool,
    pub section_context: bool,
    pub page_context: bool,
    pub screenshot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionGeometry {
    #[serde(default)]
    pub monitor_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionListResultPayload {
    pub sessions: Vec<SessionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionHistoryPayload {
    pub session_id: String,
    #[serde(default)]
    pub after_cursor: Option<u64>,
    #[serde(default)]
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionHistoryResultPayload {
    pub session_id: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<u64>,
    pub captured_through_cursor: u64,
    pub entries: Vec<SessionHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionHistoryEntry {
    pub seq: u64,
    pub time: u64,
    pub role: SessionHistoryRole,
    pub text: String,
    #[serde(default)]
    pub source_kind: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionHistoryRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionSummary {
    pub id: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SessionStatus>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub live: Option<bool>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persisted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Idle,
    Running,
    Queued,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionCreatePayload {
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub agent_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionCreatedPayload {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionSubmitPayload {
    pub session_id: String,
    pub request_id: String,
    pub mode: SessionDeliveryMode,
    pub content: Vec<PromptContentPart>,
    pub material: SelectionMaterial,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionMaterial {
    pub snapshot_id: String,
    pub revision: u64,
    pub captured_at: u64,
    pub selection: SelectionValue,
    pub source: SelectionSource,
    #[serde(default)]
    pub document: Option<SelectionDocument>,
    pub authorized_scope: SelectionMaterialScope,
    pub actual_scope: SelectionMaterialScope,
    pub completeness: SelectionMaterialCompleteness,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SelectionMaterialScope {
    Selection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SelectionMaterialCompleteness {
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionSubmittedPayload {
    pub accepted: bool,
    pub request_id: String,
    pub message_id: String,
    pub delivery: SessionDeliveryReceipt,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionDeliveryReceipt {
    Queued,
    Steered,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionSubscriptionPayload {
    pub session_id: String,
    #[serde(default)]
    pub subscription_id: Option<String>,
    #[serde(default)]
    pub cursor: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionCancelPayload {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionCancelledPayload {
    pub session_id: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionDeliveryMode {
    Queue,
    Steer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum PromptContentPart {
    Text { text: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentEventPayload {
    pub session_id: String,
    pub subscription_id: String,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub request_ids: Option<Vec<String>>,
    #[serde(default)]
    pub history: Option<SessionHistoryEntry>,
    pub event: AgentEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AgentEvent {
    pub kind: AgentEventKind,
    pub data: AgentEventData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AgentEventData {
    pub cursor: u64,
    pub persistent: bool,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentEventKind {
    Status,
    AssistantDelta,
    AssistantComplete,
    ToolCall,
    ToolResult,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ErrorResponsePayload {
    pub code: IpcErrorCode,
    pub message: String,
    #[serde(default)]
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IpcErrorCode {
    InvalidJson,
    InvalidMessage,
    ProtocolMismatch,
    UnknownMessageType,
    FrameTooLarge,
    FrameLengthMismatch,
    DuplicateRequestId,
    RequestTimeout,
    BridgeUnavailable,
    InternalError,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProtocolError {
    InvalidMessage(String),
    ProtocolMismatch(u32),
    UnknownMessageType(String),
    FrameTooLarge(usize),
    FrameLengthMismatch { declared: usize, actual: usize },
    DuplicateRequestId(String),
}

impl Display for ProtocolError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidMessage(message) => write!(f, "invalid IPC message: {message}"),
            Self::ProtocolMismatch(received) => write!(
                f,
                "unsupported IPC protocol {received}; expected {IPC_PROTOCOL_VERSION}"
            ),
            Self::UnknownMessageType(name) => write!(f, "unknown IPC message type: {name}"),
            Self::FrameTooLarge(size) => write!(
                f,
                "IPC frame payload is {size} bytes; maximum is {IPC_MAX_FRAME_BYTES}"
            ),
            Self::FrameLengthMismatch { declared, actual } => write!(
                f,
                "IPC frame declares {declared} payload bytes but contains {actual}"
            ),
            Self::DuplicateRequestId(id) => write!(f, "request id is already pending: {id}"),
        }
    }
}

impl Error for ProtocolError {}

impl IpcMessage {
    pub fn from_json(input: &str) -> Result<Self, ProtocolError> {
        let message: IpcMessage = serde_json::from_str(input)
            .map_err(|error| ProtocolError::InvalidMessage(error.to_string()))?;
        message.validate()?;
        Ok(message)
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.protocol != IPC_PROTOCOL_VERSION {
            return Err(ProtocolError::ProtocolMismatch(self.protocol));
        }
        require_text(&self.id, "id")?;
        if self.id.chars().count() > 128 {
            return Err(ProtocolError::InvalidMessage(
                "id must be at most 128 characters".into(),
            ));
        }
        if !IPC_MESSAGE_TYPES.contains(&self.type_name.as_str()) {
            return Err(ProtocolError::UnknownMessageType(self.type_name.clone()));
        }
        if !self.payload.is_object() {
            return Err(ProtocolError::InvalidMessage(
                "payload must be an object".into(),
            ));
        }

        match self.type_name.as_str() {
            "bridge.hello" => {
                let payload: BridgeHelloPayload = typed_payload(&self.payload)?;
                require_text(&payload.client.name, "client.name")?;
                require_text(&payload.client.version, "client.version")?;
                if payload.supported_protocols.is_empty() {
                    return Err(ProtocolError::InvalidMessage(
                        "supportedProtocols must not be empty".into(),
                    ));
                }
            }
            "bridge.hello.result" => {
                let payload: BridgeHelloResultPayload = typed_payload(&self.payload)?;
                if payload.protocol != IPC_PROTOCOL_VERSION {
                    return Err(ProtocolError::ProtocolMismatch(payload.protocol));
                }
                require_text(&payload.server.name, "server.name")?;
                require_text(&payload.server.version, "server.version")?;
                for capability in &payload.capabilities {
                    require_text(capability, "capabilities")?;
                }
            }
            "bridge.ping" => {
                let payload: PingPayload = typed_payload(&self.payload)?;
                require_safe_integer(payload.sent_at, "sentAt")?;
            }
            "bridge.pong" => {
                let payload: PongPayload = typed_payload(&self.payload)?;
                require_safe_integer(payload.sent_at, "sentAt")?;
                require_safe_integer(payload.received_at, "receivedAt")?;
            }
            "selection.update" => {
                let payload: SelectionUpdatePayload = typed_payload(&self.payload)?;
                payload.snapshot.validate()?;
            }
            "selection.updated" => {
                let payload: SelectionUpdatedPayload = typed_payload(&self.payload)?;
                require_text(&payload.snapshot_id, "snapshotId")?;
                require_safe_integer(payload.revision, "revision")?;
            }
            "selection.current" | "session.list" => {
                let _: EmptyPayload = typed_payload(&self.payload)?;
            }
            "selection.current.result" => {
                let payload: SelectionCurrentResultPayload = typed_payload(&self.payload)?;
                if let Some(snapshot) = payload.snapshot {
                    snapshot.validate()?;
                }
            }
            "selection.expand" => {
                let payload: SelectionExpandPayload = typed_payload(&self.payload)?;
                require_text(&payload.snapshot_id, "snapshotId")?;
            }
            "selection.expanded" => {
                let payload: SelectionExpandedPayload = typed_payload(&self.payload)?;
                require_text(&payload.snapshot_id, "snapshotId")?;
                if let Some(revision) = payload.revision {
                    require_safe_integer(revision, "revision")?;
                }
            }
            "session.list.result" => {
                let payload: SessionListResultPayload = typed_payload(&self.payload)?;
                for session in &payload.sessions {
                    require_text(&session.id, "sessions.id")?;
                }
            }
            "session.history" => {
                let payload: SessionHistoryPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
                if let Some(after_cursor) = payload.after_cursor {
                    require_safe_integer(after_cursor, "afterCursor")?;
                }
                if let Some(limit) = payload.limit {
                    if limit == 0 {
                        return Err(ProtocolError::InvalidMessage(
                            "limit must be a positive safe integer".into(),
                        ));
                    }
                    require_safe_integer(limit, "limit")?;
                    if limit > MAX_HISTORY_PAGE_ENTRIES {
                        return Err(ProtocolError::InvalidMessage(format!(
                            "limit must be no greater than {MAX_HISTORY_PAGE_ENTRIES}"
                        )));
                    }
                }
            }
            "session.history.result" => {
                let payload: SessionHistoryResultPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
                require_safe_integer(payload.captured_through_cursor, "capturedThroughCursor")?;
                if let Some(next_cursor) = payload.next_cursor {
                    require_safe_integer(next_cursor, "nextCursor")?;
                    if next_cursor >= payload.captured_through_cursor {
                        return Err(ProtocolError::InvalidMessage(
                            "nextCursor must be below capturedThroughCursor when another page remains".into(),
                        ));
                    }
                }
                for entry in &payload.entries {
                    entry.validate()?;
                }
            }
            "session.create" => {
                let payload: SessionCreatePayload = typed_payload(&self.payload)?;
                if let Some(cwd) = &payload.cwd {
                    require_text(cwd, "cwd")?;
                }
                if let Some(agent_preset) = &payload.agent_preset {
                    require_text(agent_preset, "agentPreset")?;
                }
            }
            "session.created" => {
                let payload: SessionCreatedPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
            }
            "session.submit" => {
                let payload: SessionSubmitPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
                require_text(&payload.request_id, "requestId")?;
                if payload.content.is_empty() {
                    return Err(ProtocolError::InvalidMessage(
                        "content must not be empty".into(),
                    ));
                }
                for part in &payload.content {
                    match part {
                        PromptContentPart::Text { text } => require_text(text, "content.text")?,
                    }
                }
                payload.material.validate()?;
            }
            "session.submitted" => {
                let payload: SessionSubmittedPayload = typed_payload(&self.payload)?;
                if !payload.accepted {
                    return Err(ProtocolError::InvalidMessage(
                        "session.submitted accepted must be true".into(),
                    ));
                }
                require_text(&payload.request_id, "requestId")?;
                require_text(&payload.message_id, "messageId")?;
            }
            "session.subscribe" => {
                let payload: SessionSubscriptionPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
                if let Some(cursor) = payload.cursor {
                    require_safe_integer(cursor, "cursor")?;
                }
            }
            "session.subscribed" => {
                let payload: SessionSubscriptionPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
                require_text(
                    payload.subscription_id.as_deref().unwrap_or_default(),
                    "subscriptionId",
                )?;
                if let Some(cursor) = payload.cursor {
                    require_safe_integer(cursor, "cursor")?;
                }
            }
            "session.cancel" => {
                let payload: SessionCancelPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
            }
            "session.cancelled" => {
                let payload: SessionCancelledPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
            }
            "agent.event" => {
                let payload: AgentEventPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
                require_text(&payload.subscription_id, "subscriptionId")?;
                if let Some(request_id) = &payload.request_id {
                    require_text(request_id, "requestId")?;
                }
                if let Some(request_ids) = &payload.request_ids {
                    if request_ids.is_empty() {
                        return Err(ProtocolError::InvalidMessage(
                            "requestIds must not be empty".into(),
                        ));
                    }
                    for request_id in request_ids {
                        require_text(request_id, "requestIds")?;
                    }
                }
                require_safe_integer(payload.event.data.cursor, "event.data.cursor")?;
                if let Some(history) = &payload.history {
                    history.validate()?;
                    if !payload.event.data.persistent {
                        return Err(ProtocolError::InvalidMessage(
                            "history requires a persistent event".into(),
                        ));
                    }
                    if history.seq != payload.event.data.cursor {
                        return Err(ProtocolError::InvalidMessage(
                            "history.seq must equal event.data.cursor".into(),
                        ));
                    }
                }
            }
            "error.response" => {
                let payload: ErrorResponsePayload = typed_payload(&self.payload)?;
                require_text(&payload.message, "message")?;
            }
            _ => {}
        }
        Ok(())
    }
}

impl SelectionSnapshot {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_text(&self.id, "snapshot.id")?;
        if self.id.chars().count() > 256 {
            return Err(ProtocolError::InvalidMessage(
                "snapshot.id must be at most 256 characters".into(),
            ));
        }
        require_safe_integer(self.revision, "snapshot.revision")?;
        require_safe_integer(self.captured_at, "snapshot.capturedAt")?;
        if self.selection.text.trim().is_empty() {
            return Err(ProtocolError::InvalidMessage(
                "selection.text must not be empty".into(),
            ));
        }
        require_text(&self.provider, "provider")?;
        if !self.confidence.is_finite() || !(0.0..=1.0).contains(&self.confidence) {
            return Err(ProtocolError::InvalidMessage(
                "confidence must be between 0 and 1".into(),
            ));
        }
        if let Some(geometry) = &self.geometry {
            if !geometry.x.is_finite()
                || !geometry.y.is_finite()
                || !geometry.width.is_finite()
                || !geometry.height.is_finite()
                || geometry.width < 0.0
                || geometry.height < 0.0
            {
                return Err(ProtocolError::InvalidMessage(
                    "invalid selection geometry".into(),
                ));
            }
        }
        Ok(())
    }
}

impl SessionHistoryEntry {
    fn validate(&self) -> Result<(), ProtocolError> {
        require_safe_integer(self.seq, "entries.seq")?;
        require_safe_integer(self.time, "entries.time")?;
        require_text(&self.text, "entries.text")?;
        if let Some(source_kind) = &self.source_kind {
            require_text(source_kind, "entries.sourceKind")?;
        }
        if let Some(request_id) = &self.request_id {
            require_text(request_id, "entries.requestId")?;
        }
        Ok(())
    }
}

impl SelectionMaterial {
    pub fn from_snapshot(snapshot: &SelectionSnapshot) -> Self {
        Self {
            snapshot_id: snapshot.id.clone(),
            revision: snapshot.revision,
            captured_at: snapshot.captured_at,
            selection: snapshot.selection.clone(),
            source: snapshot.source.clone(),
            document: snapshot.document.clone(),
            authorized_scope: SelectionMaterialScope::Selection,
            actual_scope: SelectionMaterialScope::Selection,
            completeness: SelectionMaterialCompleteness::Complete,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        require_text(&self.snapshot_id, "material.snapshotId")?;
        if self.snapshot_id.chars().count() > 256 {
            return Err(ProtocolError::InvalidMessage(
                "material.snapshotId must be at most 256 characters".into(),
            ));
        }
        require_safe_integer(self.revision, "material.revision")?;
        require_safe_integer(self.captured_at, "material.capturedAt")?;
        if self.selection.text.trim().is_empty() {
            return Err(ProtocolError::InvalidMessage(
                "material.selection.text must not be blank".into(),
            ));
        }
        Ok(())
    }
}

fn typed_payload<T>(payload: &Value) -> Result<T, ProtocolError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(payload.clone())
        .map_err(|error| ProtocolError::InvalidMessage(error.to_string()))
}

pub fn encode_frame(message: &IpcMessage) -> Result<Vec<u8>, ProtocolError> {
    message.validate()?;
    let payload = serde_json::to_vec(message)
        .map_err(|error| ProtocolError::InvalidMessage(error.to_string()))?;
    if payload.len() > IPC_MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge(payload.len()));
    }
    let mut frame = Vec::with_capacity(IPC_FRAME_HEADER_BYTES + payload.len());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub fn decode_frame(frame: &[u8]) -> Result<IpcMessage, ProtocolError> {
    if frame.len() < IPC_FRAME_HEADER_BYTES {
        return Err(ProtocolError::FrameLengthMismatch {
            declared: 0,
            actual: frame.len(),
        });
    }
    let declared = u32::from_be_bytes(frame[0..4].try_into().expect("four-byte header")) as usize;
    if declared > IPC_MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge(declared));
    }
    let actual = frame.len() - IPC_FRAME_HEADER_BYTES;
    if declared != actual {
        return Err(ProtocolError::FrameLengthMismatch { declared, actual });
    }
    let json = std::str::from_utf8(&frame[IPC_FRAME_HEADER_BYTES..])
        .map_err(|error| ProtocolError::InvalidMessage(error.to_string()))?;
    IpcMessage::from_json(json)
}

#[derive(Debug, Default)]
pub struct FrameDecoder {
    buffer: Vec<u8>,
}

impl FrameDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<IpcMessage>, ProtocolError> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();
        loop {
            if self.buffer.len() < IPC_FRAME_HEADER_BYTES {
                break;
            }
            let declared =
                u32::from_be_bytes(self.buffer[0..4].try_into().expect("four-byte header"))
                    as usize;
            if declared > IPC_MAX_FRAME_BYTES {
                self.buffer.clear();
                return Err(ProtocolError::FrameTooLarge(declared));
            }
            let frame_len = IPC_FRAME_HEADER_BYTES + declared;
            if self.buffer.len() < frame_len {
                break;
            }
            let frame: Vec<u8> = self.buffer.drain(..frame_len).collect();
            messages.push(decode_frame(&frame)?);
        }
        Ok(messages)
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
    }

    pub fn buffered_bytes(&self) -> usize {
        self.buffer.len()
    }
}

#[derive(Debug)]
pub struct RequestTracker {
    pending: HashMap<String, u64>,
    timeout_ms: u64,
}

impl RequestTracker {
    pub fn new(timeout_ms: u64) -> Result<Self, ProtocolError> {
        if timeout_ms == 0 {
            return Err(ProtocolError::InvalidMessage(
                "timeout must be greater than zero".into(),
            ));
        }
        Ok(Self {
            pending: HashMap::new(),
            timeout_ms,
        })
    }

    pub fn begin(&mut self, id: &str, now_ms: u64) -> Result<(), ProtocolError> {
        require_text(id, "request id")?;
        if id.chars().count() > 128 {
            return Err(ProtocolError::InvalidMessage(
                "request id must be at most 128 characters".into(),
            ));
        }
        if self.pending.contains_key(id) {
            return Err(ProtocolError::DuplicateRequestId(id.to_owned()));
        }
        self.pending
            .insert(id.to_owned(), now_ms.saturating_add(self.timeout_ms));
        Ok(())
    }

    pub fn complete(&mut self, id: &str) -> bool {
        self.pending.remove(id).is_some()
    }

    pub fn expire(&mut self, now_ms: u64) -> Vec<String> {
        let mut expired: Vec<String> = self
            .pending
            .iter()
            .filter_map(|(id, deadline)| (*deadline <= now_ms).then_some(id.clone()))
            .collect();
        expired.sort();
        for id in &expired {
            self.pending.remove(id);
        }
        expired
    }

    pub fn reset(&mut self) -> Vec<String> {
        let mut abandoned: Vec<String> = self.pending.keys().cloned().collect();
        abandoned.sort();
        self.pending.clear();
        abandoned
    }

    pub fn len(&self) -> usize {
        self.pending.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

fn require_text(value: &str, field: &str) -> Result<(), ProtocolError> {
    if value.is_empty() {
        return Err(ProtocolError::InvalidMessage(format!(
            "{field} must not be empty"
        )));
    }
    Ok(())
}

fn require_safe_integer(value: u64, field: &str) -> Result<(), ProtocolError> {
    if value > MAX_SAFE_INTEGER {
        return Err(ProtocolError::InvalidMessage(format!(
            "{field} must be a non-negative safe integer"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &[&str] = &[
        include_str!("../../../tests/protocol/bridge.hello.request.json"),
        include_str!("../../../tests/protocol/bridge.hello.response.json"),
        include_str!("../../../tests/protocol/selection.update.request.json"),
        include_str!("../../../tests/protocol/session.submit.request.json"),
        include_str!("../../../tests/protocol/session.submit.rust-null-optionals.request.json"),
        include_str!("../../../tests/protocol/session.submitted.response.json"),
        include_str!("../../../tests/protocol/session.cancel.request.json"),
        include_str!("../../../tests/protocol/session.history.request.json"),
        include_str!("../../../tests/protocol/session.history.response.json"),
        include_str!("../../../tests/protocol/agent.event.json"),
        include_str!("../../../tests/protocol/selection.expanded.response.json"),
        include_str!("../../../tests/protocol/error.response.json"),
    ];
    const INVALID_FIXTURES: &[&str] = &[
        include_str!("../../../tests/protocol/invalid/bridge.ping.unknown-field.json"),
        include_str!("../../../tests/protocol/invalid/selection.expand.missing-scope.json"),
        include_str!("../../../tests/protocol/invalid/selection.update.unknown-field.json"),
        include_str!("../../../tests/protocol/invalid/session.subscribe.negative-cursor.json"),
        include_str!("../../../tests/protocol/invalid/session.history.negative-cursor.json"),
        include_str!("../../../tests/protocol/invalid/session.history.limit-too-large.json"),
        include_str!("../../../tests/protocol/invalid/session.submit.empty-content.json"),
        include_str!(
            "../../../tests/protocol/invalid/session.submit.blank-material-selection.json"
        ),
        include_str!("../../../tests/protocol/invalid/session.submit.missing-material.json"),
        include_str!("../../../tests/protocol/invalid/session.submit.invalid-material-scope.json"),
        include_str!("../../../tests/protocol/invalid/session.submitted.missing-message-id.json"),
        include_str!("../../../tests/protocol/invalid/agent.event.missing-persistence.json"),
        include_str!("../../../tests/protocol/invalid/agent.event.history-cursor-mismatch.json"),
    ];

    #[test]
    fn parses_all_shared_golden_fixtures() {
        for fixture in FIXTURES {
            IpcMessage::from_json(fixture).expect("fixture must match Rust protocol contract");
        }
    }

    #[test]
    fn rejects_all_shared_invalid_fixtures() {
        for fixture in INVALID_FIXTURES {
            assert!(
                IpcMessage::from_json(fixture).is_err(),
                "invalid fixture unexpectedly parsed: {fixture}"
            );
        }
    }

    #[test]
    fn rejects_protocol_mismatch_and_unknown_message_type() {
        let mismatch = r#"{"protocol":1,"id":"x","type":"bridge.ping","payload":{"sentAt":1}}"#;
        assert!(matches!(
            IpcMessage::from_json(mismatch),
            Err(ProtocolError::ProtocolMismatch(1))
        ));

        let unknown = r#"{"protocol":3,"id":"x","type":"unknown.method","payload":{}}"#;
        assert!(matches!(
            IpcMessage::from_json(unknown),
            Err(ProtocolError::UnknownMessageType(_))
        ));
    }

    #[test]
    fn session_submit_v3_requires_and_preserves_fixed_material() {
        let submit = IpcMessage::from_json(FIXTURES[3]).unwrap();
        assert_eq!(IPC_PROTOCOL_VERSION, 3);
        assert_eq!(submit.protocol, IPC_PROTOCOL_VERSION);

        let payload: SessionSubmitPayload = serde_json::from_value(submit.payload.clone()).unwrap();
        assert_eq!(payload.material.snapshot_id, "selection-demo");
        assert_eq!(payload.material.revision, 7);
        assert_eq!(
            payload.material.selection.text,
            "Gaussian-process posterior uncertainty"
        );
        assert_eq!(
            payload.material.authorized_scope,
            SelectionMaterialScope::Selection
        );
        assert_eq!(
            payload.material.actual_scope,
            SelectionMaterialScope::Selection
        );
        assert_eq!(
            payload.material.completeness,
            SelectionMaterialCompleteness::Complete
        );

        let missing_material = serde_json::json!({
            "protocol": IPC_PROTOCOL_VERSION,
            "id": "submit-without-material",
            "type": "session.submit",
            "payload": {
                "sessionId": "session-demo",
                "requestId": "request-demo",
                "mode": "queue",
                "content": [{ "type": "text", "text": "Explain the selection." }]
            }
        });
        assert!(IpcMessage::from_json(&missing_material.to_string()).is_err());
    }

    #[test]
    fn frames_round_trip_and_support_partial_chunks() {
        let message = IpcMessage::from_json(FIXTURES[0]).unwrap();
        let frame = encode_frame(&message).unwrap();
        assert_eq!(decode_frame(&frame).unwrap(), message);

        let mut decoder = FrameDecoder::default();
        assert!(decoder.push(&frame[..3]).unwrap().is_empty());
        let messages = decoder.push(&frame[3..]).unwrap();
        assert_eq!(messages, vec![message]);
        assert_eq!(decoder.buffered_bytes(), 0);
    }

    #[test]
    fn rejects_bad_frame_lengths_and_oversized_declarations() {
        let message = IpcMessage::from_json(FIXTURES[0]).unwrap();
        let mut frame = encode_frame(&message).unwrap();
        frame.pop();
        assert!(matches!(
            decode_frame(&frame),
            Err(ProtocolError::FrameLengthMismatch { .. })
        ));

        let oversized = ((IPC_MAX_FRAME_BYTES + 1) as u32).to_be_bytes();
        assert!(matches!(
            decode_frame(&oversized),
            Err(ProtocolError::FrameTooLarge(_))
        ));
    }

    #[test]
    fn tracks_duplicates_timeouts_and_transport_reset() {
        let mut tracker = RequestTracker::new(100).unwrap();
        tracker.begin("req-1", 1_000).unwrap();
        assert!(matches!(
            tracker.begin("req-1", 1_001),
            Err(ProtocolError::DuplicateRequestId(_))
        ));
        assert!(tracker.expire(1_099).is_empty());
        assert_eq!(tracker.expire(1_100), vec!["req-1"]);

        tracker.begin("req-2", 2_000).unwrap();
        tracker.begin("req-3", 2_000).unwrap();
        assert_eq!(tracker.reset(), vec!["req-2", "req-3"]);
        assert!(tracker.is_empty());
    }
}
