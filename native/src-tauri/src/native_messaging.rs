use serde_json::json;
use std::env;
use std::io::{Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::bridge::DEFAULT_PIPE_NAME;
use crate::protocol::{
    BridgeHelloResultPayload, IpcMessage, ProtocolError, IPC_FRAME_HEADER_BYTES,
    IPC_MAX_FRAME_BYTES, IPC_PROTOCOL_VERSION,
};

pub const NATIVE_HOST_NAME: &str = "io.github.mivaille777.dsh_selection_companion";
pub const NATIVE_MESSAGE_MAX_BYTES: usize = IPC_MAX_FRAME_BYTES;

#[cfg(windows)]
const O_BINARY: i32 = 0x8000;

#[cfg(windows)]
unsafe extern "C" {
    fn _setmode(fd: i32, mode: i32) -> i32;
}

pub fn run_stdio() -> Result<(), String> {
    #[cfg(not(windows))]
    {
        return Err("browser native messaging host is Windows-only".to_owned());
    }

    #[cfg(windows)]
    {
        // Chrome Native Messaging is a binary protocol: a 4-byte little-endian
        // payload length followed by raw UTF-8 JSON bytes. Windows CRT text mode
        // may translate CR/LF on stdin/stdout, so switch both descriptors before
        // constructing or locking any Rust stdio handles.
        configure_stdio_binary()?;

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())?;
        let endpoint = env::var("DSH_SELECTION_COMPANION_PIPE")
            .unwrap_or_else(|_| DEFAULT_PIPE_NAME.to_owned());
        let mut host = NativeMessagingHost::new(endpoint);
        let stdin = std::io::stdin();
        let stdout = std::io::stdout();
        let mut input = stdin.lock();
        let mut output = stdout.lock();

        loop {
            let Some(raw) = read_native_json(&mut input)? else {
                break;
            };
            let response = match IpcMessage::from_json(&raw) {
                Ok(message) => runtime.block_on(host.forward(message)),
                Err(error) => protocol_error_response(extract_message_id(&raw), error),
            };
            write_native_message(&mut output, &response)?;
            output.flush().map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

#[cfg(windows)]
fn configure_stdio_binary() -> Result<(), String> {
    set_binary_mode(0, "stdin")?;
    set_binary_mode(1, "stdout")?;
    Ok(())
}

#[cfg(windows)]
fn set_binary_mode(fd: i32, name: &str) -> Result<(), String> {
    // SAFETY: `_setmode` is the Windows CRT API for changing translation mode
    // of an existing CRT file descriptor. Native Messaging hosts receive stdin
    // and stdout as descriptors 0 and 1 from Chromium.
    let previous_mode = unsafe { _setmode(fd, O_BINARY) };
    if previous_mode == -1 {
        return Err(format!(
            "failed to set native messaging {name} (fd {fd}) to O_BINARY"
        ));
    }
    Ok(())
}

fn read_native_json<R: Read>(reader: &mut R) -> Result<Option<String>, String> {
    let mut header = [0_u8; 4];
    let first = reader.read(&mut header[..1]).map_err(|error| error.to_string())?;
    if first == 0 {
        return Ok(None);
    }
    reader
        .read_exact(&mut header[1..])
        .map_err(|error| format!("truncated native messaging header: {error}"))?;
    let declared = u32::from_le_bytes(header) as usize;
    if declared > NATIVE_MESSAGE_MAX_BYTES {
        return Err(format!(
            "native message declares {declared} bytes; maximum is {NATIVE_MESSAGE_MAX_BYTES}"
        ));
    }
    let mut payload = vec![0_u8; declared];
    reader
        .read_exact(&mut payload)
        .map_err(|error| format!("truncated native messaging payload: {error}"))?;
    String::from_utf8(payload).map(Some).map_err(|error| error.to_string())
}

fn write_native_message<W: Write>(writer: &mut W, message: &IpcMessage) -> Result<(), String> {
    message.validate().map_err(|error| error.to_string())?;
    let payload = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    if payload.len() > NATIVE_MESSAGE_MAX_BYTES {
        return Err(format!(
            "native message payload is {} bytes; maximum is {NATIVE_MESSAGE_MAX_BYTES}",
            payload.len()
        ));
    }
    writer
        .write_all(&(payload.len() as u32).to_le_bytes())
        .map_err(|error| error.to_string())?;
    writer.write_all(&payload).map_err(|error| error.to_string())
}

fn extract_message_id(raw: &str) -> String {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|value| value.get("id").and_then(|id| id.as_str()).map(str::to_owned))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("native-error-{}", now_millis()))
}

fn protocol_error_response(id: String, error: ProtocolError) -> IpcMessage {
    let message = error.to_string();
    let code = match &error {
        ProtocolError::ProtocolMismatch(_) => "PROTOCOL_MISMATCH",
        ProtocolError::UnknownMessageType(_) => "UNKNOWN_MESSAGE_TYPE",
        ProtocolError::FrameTooLarge(_) => "FRAME_TOO_LARGE",
        ProtocolError::FrameLengthMismatch { .. } => "FRAME_LENGTH_MISMATCH",
        ProtocolError::DuplicateRequestId(_) => "DUPLICATE_REQUEST_ID",
        ProtocolError::InvalidMessage(_) => "INVALID_MESSAGE",
    };
    error_response(id, code, message)
}

fn error_response(id: String, code: &str, message: String) -> IpcMessage {
    IpcMessage {
        protocol: IPC_PROTOCOL_VERSION,
        id,
        type_name: "error.response".to_owned(),
        payload: json!({ "code": code, "message": message }),
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(windows)]
struct NativeMessagingHost {
    endpoint: String,
    client: Option<tokio::net::windows::named_pipe::NamedPipeClient>,
}

#[cfg(windows)]
impl NativeMessagingHost {
    fn new(endpoint: String) -> Self {
        Self {
            endpoint,
            client: None,
        }
    }

    async fn forward(&mut self, message: IpcMessage) -> IpcMessage {
        if !matches!(message.type_name.as_str(), "selection.update" | "bridge.ping") {
            return error_response(
                message.id,
                "INVALID_MESSAGE",
                "browser native host only accepts selection.update and bridge.ping".to_owned(),
            );
        }

        match self.forward_once(&message).await {
            Ok(response) => response,
            Err(_) => {
                self.client = None;
                match self.forward_once(&message).await {
                    Ok(response) => response,
                    Err(error) => error_response(message.id, "BRIDGE_UNAVAILABLE", error),
                }
            }
        }
    }

    async fn forward_once(&mut self, message: &IpcMessage) -> Result<IpcMessage, String> {
        self.ensure_connected().await?;
        let client = self.client.as_mut().expect("connected native pipe client");
        exchange(client, message).await
    }

    async fn ensure_connected(&mut self) -> Result<(), String> {
        if self.client.is_some() {
            return Ok(());
        }

        use tokio::net::windows::named_pipe::ClientOptions;
        use tokio::time::{sleep, Duration};

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
                "cannot connect native browser host to Harness pipe {}: {}",
                self.endpoint,
                last_error.unwrap_or_else(|| "unknown error".to_owned())
            ));
        };

        let hello_id = format!("browser-host-hello-{}", now_millis());
        let hello = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: hello_id.clone(),
            type_name: "bridge.hello".to_owned(),
            payload: json!({
                "client": {
                    "name": "dsh-selection-companion-browser-host",
                    "version": env!("CARGO_PKG_VERSION"),
                    "platform": "windows"
                },
                "supportedProtocols": [IPC_PROTOCOL_VERSION]
            }),
        };
        let response = exchange(&mut client, &hello).await?;
        if response.id != hello_id || response.type_name != "bridge.hello.result" {
            return Err(format!("unexpected Harness hello response: {}", response.type_name));
        }
        let hello_result: BridgeHelloResultPayload = serde_json::from_value(response.payload)
            .map_err(|error| format!("invalid Harness hello payload: {error}"))?;
        if hello_result.protocol != IPC_PROTOCOL_VERSION {
            return Err(format!(
                "Harness selected protocol {}, expected {}",
                hello_result.protocol, IPC_PROTOCOL_VERSION
            ));
        }
        self.client = Some(client);
        Ok(())
    }
}

#[cfg(windows)]
async fn exchange(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
    message: &IpcMessage,
) -> Result<IpcMessage, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let frame = crate::protocol::encode_frame(message).map_err(|error| error.to_string())?;
    client.write_all(&frame).await.map_err(|error| error.to_string())?;
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
    let mut frame = Vec::with_capacity(IPC_FRAME_HEADER_BYTES + declared);
    frame.extend_from_slice(&header);
    frame.extend_from_slice(&payload);
    crate::protocol::decode_frame(&frame).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn chrome_native_framing_is_little_endian_and_round_trips() {
        let message = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: "native-test-1".to_owned(),
            type_name: "bridge.ping".to_owned(),
            payload: json!({ "sentAt": 123 }),
        };
        let mut bytes = Vec::new();
        write_native_message(&mut bytes, &message).unwrap();
        let declared = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
        assert_eq!(declared, bytes.len() - 4);

        let mut cursor = Cursor::new(bytes);
        let raw = read_native_json(&mut cursor).unwrap().unwrap();
        assert_eq!(IpcMessage::from_json(&raw).unwrap(), message);
    }

    #[test]
    fn native_reader_returns_none_on_clean_eof() {
        let mut cursor = Cursor::new(Vec::<u8>::new());
        assert_eq!(read_native_json(&mut cursor).unwrap(), None);
    }

    #[test]
    fn protocol_errors_remain_protocol_v1_messages() {
        let response = protocol_error_response(
            "bad-1".to_owned(),
            ProtocolError::UnknownMessageType("bad.type".to_owned()),
        );
        assert_eq!(response.type_name, "error.response");
        response.validate().unwrap();
    }
}
