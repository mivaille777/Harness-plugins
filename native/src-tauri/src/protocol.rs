use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::error::Error;
use std::fmt::{Display, Formatter};

pub const IPC_PROTOCOL_VERSION: u32 = 1;
pub const IPC_MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const IPC_FRAME_HEADER_BYTES: usize = 4;
pub const DEFAULT_IPC_REQUEST_TIMEOUT_MS: u64 = 30_000;

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
    "session.create",
    "session.created",
    "session.submit",
    "session.submitted",
    "session.subscribe",
    "session.subscribed",
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
pub struct SessionSubmitPayload {
    pub session_id: String,
    pub request_id: String,
    pub mode: SessionDeliveryMode,
    pub content: Vec<PromptContentPart>,
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
    #[serde(default)]
    pub request_id: Option<String>,
    pub event: AgentEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AgentEvent {
    pub kind: AgentEventKind,
    pub data: Value,
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
            Self::ProtocolMismatch(received) => write!(f, "unsupported IPC protocol {received}; expected {IPC_PROTOCOL_VERSION}"),
            Self::UnknownMessageType(name) => write!(f, "unknown IPC message type: {name}"),
            Self::FrameTooLarge(size) => write!(f, "IPC frame payload is {size} bytes; maximum is {IPC_MAX_FRAME_BYTES}"),
            Self::FrameLengthMismatch { declared, actual } => write!(f, "IPC frame declares {declared} payload bytes but contains {actual}"),
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
            return Err(ProtocolError::InvalidMessage("id must be at most 128 characters".into()));
        }
        if !IPC_MESSAGE_TYPES.contains(&self.type_name.as_str()) {
            return Err(ProtocolError::UnknownMessageType(self.type_name.clone()));
        }
        if !self.payload.is_object() {
            return Err(ProtocolError::InvalidMessage("payload must be an object".into()));
        }

        match self.type_name.as_str() {
            "bridge.hello" => {
                let payload: BridgeHelloPayload = typed_payload(&self.payload)?;
                require_text(&payload.client.name, "client.name")?;
                require_text(&payload.client.version, "client.version")?;
                if payload.supported_protocols.is_empty() {
                    return Err(ProtocolError::InvalidMessage("supportedProtocols must not be empty".into()));
                }
            }
            "bridge.hello.result" => {
                let payload: BridgeHelloResultPayload = typed_payload(&self.payload)?;
                if payload.protocol != IPC_PROTOCOL_VERSION {
                    return Err(ProtocolError::ProtocolMismatch(payload.protocol));
                }
                require_text(&payload.server.name, "server.name")?;
                require_text(&payload.server.version, "server.version")?;
            }
            "selection.update" => {
                let payload: SelectionUpdatePayload = typed_payload(&self.payload)?;
                payload.snapshot.validate()?;
            }
            "session.submit" => {
                let payload: SessionSubmitPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
                require_text(&payload.request_id, "requestId")?;
                if payload.content.is_empty() {
                    return Err(ProtocolError::InvalidMessage("content must not be empty".into()));
                }
                for part in &payload.content {
                    match part {
                        PromptContentPart::Text { text } => require_text(text, "content.text")?,
                    }
                }
            }
            "agent.event" => {
                let payload: AgentEventPayload = typed_payload(&self.payload)?;
                require_text(&payload.session_id, "sessionId")?;
                if let Some(request_id) = &payload.request_id {
                    require_text(request_id, "requestId")?;
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
            return Err(ProtocolError::InvalidMessage("snapshot.id must be at most 256 characters".into()));
        }
        if self.selection.text.trim().is_empty() {
            return Err(ProtocolError::InvalidMessage("selection.text must not be empty".into()));
        }
        require_text(&self.provider, "provider")?;
        if !self.confidence.is_finite() || !(0.0..=1.0).contains(&self.confidence) {
            return Err(ProtocolError::InvalidMessage("confidence must be between 0 and 1".into()));
        }
        if let Some(geometry) = &self.geometry {
            if !geometry.x.is_finite()
                || !geometry.y.is_finite()
                || !geometry.width.is_finite()
                || !geometry.height.is_finite()
                || geometry.width < 0.0
                || geometry.height < 0.0
            {
                return Err(ProtocolError::InvalidMessage("invalid selection geometry".into()));
            }
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
        return Err(ProtocolError::FrameLengthMismatch { declared: 0, actual: frame.len() });
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
            let declared = u32::from_be_bytes(self.buffer[0..4].try_into().expect("four-byte header")) as usize;
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
            return Err(ProtocolError::InvalidMessage("timeout must be greater than zero".into()));
        }
        Ok(Self { pending: HashMap::new(), timeout_ms })
    }

    pub fn begin(&mut self, id: &str, now_ms: u64) -> Result<(), ProtocolError> {
        require_text(id, "request id")?;
        if id.chars().count() > 128 {
            return Err(ProtocolError::InvalidMessage("request id must be at most 128 characters".into()));
        }
        if self.pending.contains_key(id) {
            return Err(ProtocolError::DuplicateRequestId(id.to_owned()));
        }
        self.pending.insert(id.to_owned(), now_ms.saturating_add(self.timeout_ms));
        Ok(())
    }

    pub fn complete(&mut self, id: &str) -> bool {
        self.pending.remove(id).is_some()
    }

    pub fn expire(&mut self, now_ms: u64) -> Vec<String> {
        let mut expired: Vec<String> = self.pending.iter()
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
        return Err(ProtocolError::InvalidMessage(format!("{field} must not be empty")));
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
        include_str!("../../../tests/protocol/agent.event.json"),
        include_str!("../../../tests/protocol/error.response.json"),
    ];

    #[test]
    fn parses_all_shared_golden_fixtures() {
        for fixture in FIXTURES {
            IpcMessage::from_json(fixture).expect("fixture must match Rust protocol contract");
        }
    }

    #[test]
    fn rejects_protocol_mismatch_and_unknown_message_type() {
        let mismatch = r#"{"protocol":2,"id":"x","type":"bridge.ping","payload":{"sentAt":1}}"#;
        assert!(matches!(IpcMessage::from_json(mismatch), Err(ProtocolError::ProtocolMismatch(2))));

        let unknown = r#"{"protocol":1,"id":"x","type":"unknown.method","payload":{}}"#;
        assert!(matches!(IpcMessage::from_json(unknown), Err(ProtocolError::UnknownMessageType(_))));
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
        assert!(matches!(decode_frame(&frame), Err(ProtocolError::FrameLengthMismatch { .. })));

        let oversized = ((IPC_MAX_FRAME_BYTES + 1) as u32).to_be_bytes();
        assert!(matches!(decode_frame(&oversized), Err(ProtocolError::FrameTooLarge(_))));
    }

    #[test]
    fn tracks_duplicates_timeouts_and_transport_reset() {
        let mut tracker = RequestTracker::new(100).unwrap();
        tracker.begin("req-1", 1_000).unwrap();
        assert!(matches!(tracker.begin("req-1", 1_001), Err(ProtocolError::DuplicateRequestId(_))));
        assert!(tracker.expire(1_099).is_empty());
        assert_eq!(tracker.expire(1_100), vec!["req-1"]);

        tracker.begin("req-2", 2_000).unwrap();
        tracker.begin("req-3", 2_000).unwrap();
        assert_eq!(tracker.reset(), vec!["req-2", "req-3"]);
        assert!(tracker.is_empty());
    }
}
