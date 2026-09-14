use std::env;
use std::time::Duration;

use serde_json::Value;

use crate::bridge::{SessionSubmission, DEFAULT_PIPE_NAME};
use crate::protocol::{
    decode_frame, encode_frame, IpcMessage, SessionCreatedPayload, SessionDeliveryReceipt,
    SessionSubmittedPayload, IPC_FRAME_HEADER_BYTES, IPC_MAX_FRAME_BYTES, IPC_PROTOCOL_VERSION,
};
use crate::submission_material::normalize_submission_material;

const DEFAULT_SUBMIT_TIMEOUT_MS: u64 = 5_000;

/// EC-05 command boundary: accepts canonical SelectionMaterial directly.
///
/// `normalize_submission_material` retains a temporary legacy SelectionSnapshot
/// fallback, but the Lens path sends canonical material and this module forwards
/// that exact validated value in Protocol V4 `session.submit`.
#[tauri::command]
pub async fn bridge_submit_prompt(
    session_id: Option<String>,
    content: String,
    request_id: String,
    material: Value,
) -> Result<SessionSubmission, String> {
    if content.trim().is_empty() {
        return Err("session prompt must not be empty".to_owned());
    }
    if request_id.trim().is_empty() {
        return Err("logical request id must not be empty".to_owned());
    }
    let material = normalize_submission_material(material)?;

    #[cfg(windows)]
    {
        return submit_windows(session_id, content, request_id, material).await;
    }

    #[cfg(not(windows))]
    {
        let _ = (session_id, content, request_id, material);
        Err("Selection Companion native bridge is Windows-only".to_owned())
    }
}

#[cfg(windows)]
async fn submit_windows(
    session_id: Option<String>,
    content: String,
    logical_request_id: String,
    material: crate::protocol::SelectionMaterial,
) -> Result<SessionSubmission, String> {
    use tokio::net::windows::named_pipe::ClientOptions;
    use tokio::time::sleep;

    let endpoint = env::var("DSH_SELECTION_COMPANION_PIPE")
        .unwrap_or_else(|_| DEFAULT_PIPE_NAME.to_owned());
    let timeout = submit_timeout()?;

    let mut last_error = None;
    let mut client = None;
    for attempt in 0..20 {
        match ClientOptions::new().open(&endpoint) {
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
            "cannot connect to Harness named pipe {endpoint}: {}",
            last_error.unwrap_or_else(|| "unknown error".to_owned())
        ));
    };

    let hello_id = transport_id("hello");
    let hello = IpcMessage {
        protocol: IPC_PROTOCOL_VERSION,
        id: hello_id.clone(),
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
    let hello_response = exchange(&mut client, &hello, timeout).await?;
    ensure_response_id(&hello_response, &hello_id)?;
    if hello_response.type_name == "error.response" {
        return Err(format!("Harness rejected bridge hello: {}", hello_response.payload));
    }
    if hello_response.type_name != "bridge.hello.result" {
        return Err(format!(
            "unexpected bridge hello response: {}",
            hello_response.type_name
        ));
    }
    let selected_protocol = hello_response
        .payload
        .get("protocol")
        .and_then(Value::as_u64)
        .ok_or_else(|| "bridge.hello.result response has no protocol".to_owned())?;
    if selected_protocol != IPC_PROTOCOL_VERSION as u64 {
        return Err(format!(
            "Harness selected protocol {selected_protocol}, expected {IPC_PROTOCOL_VERSION}"
        ));
    }

    let session_id = match session_id {
        Some(id) if !id.trim().is_empty() => id,
        Some(_) => return Err("session id must not be empty".to_owned()),
        None => create_session(&mut client, timeout).await?,
    };

    let transport_id = transport_id("session-submit");
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

    let response = exchange(&mut client, &submit, timeout)
        .await
        .map_err(|error| submission_unknown(&session_id, &logical_request_id, error))?;
    ensure_response_id(&response, &transport_id)
        .map_err(|error| submission_unknown(&session_id, &logical_request_id, error))?;
    if response.type_name == "error.response" {
        return Err(format!("Harness rejected session submission: {}", response.payload));
    }
    if response.type_name != "session.submitted" {
        return Err(submission_unknown(
            &session_id,
            &logical_request_id,
            format!("unexpected session.submit response: {}", response.type_name),
        ));
    }
    let submitted: SessionSubmittedPayload = serde_json::from_value(response.payload)
        .map_err(|error| {
            submission_unknown(
                &session_id,
                &logical_request_id,
                format!("invalid session.submitted payload: {error}"),
            )
        })?;
    if submitted.request_id != logical_request_id {
        return Err(submission_unknown(
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
            SessionDeliveryReceipt::Queued => "queued".to_owned(),
            SessionDeliveryReceipt::Steered => "steered".to_owned(),
        },
        duplicate: submitted.duplicate,
    })
}

#[cfg(windows)]
async fn create_session(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
    timeout: Duration,
) -> Result<String, String> {
    let id = transport_id("session-create");
    let create = IpcMessage {
        protocol: IPC_PROTOCOL_VERSION,
        id: id.clone(),
        type_name: "session.create".to_owned(),
        payload: serde_json::json!({}),
    };
    let response = exchange(client, &create, timeout)
        .await
        .map_err(|error| format!("CREATE_UNKNOWN|{id}|{error}"))?;
    ensure_response_id(&response, &id)
        .map_err(|error| format!("CREATE_UNKNOWN|{id}|{error}"))?;
    if response.type_name == "error.response" {
        return Err(format!("Harness rejected session creation: {}", response.payload));
    }
    if response.type_name != "session.created" {
        return Err(format!(
            "CREATE_UNKNOWN|{id}|unexpected session.create response: {}",
            response.type_name
        ));
    }
    let created: SessionCreatedPayload = serde_json::from_value(response.payload)
        .map_err(|error| format!("CREATE_UNKNOWN|{id}|invalid session.created payload: {error}"))?;
    if created.session_id.trim().is_empty() {
        return Err(format!("CREATE_UNKNOWN|{id}|session.created response has no sessionId"));
    }
    Ok(created.session_id)
}

#[cfg(windows)]
async fn exchange(
    client: &mut tokio::net::windows::named_pipe::NamedPipeClient,
    message: &IpcMessage,
    request_timeout: Duration,
) -> Result<IpcMessage, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::time::timeout;

    let frame = encode_frame(message).map_err(|error| error.to_string())?;
    timeout(request_timeout, async {
        client.write_all(&frame).await.map_err(|error| error.to_string())?;
        client.flush().await.map_err(|error| error.to_string())?;

        let mut header = [0_u8; IPC_FRAME_HEADER_BYTES];
        client.read_exact(&mut header).await.map_err(|error| error.to_string())?;
        let declared = u32::from_be_bytes(header) as usize;
        if declared > IPC_MAX_FRAME_BYTES {
            return Err(format!(
                "Harness frame declares {declared} bytes; maximum is {IPC_MAX_FRAME_BYTES}"
            ));
        }
        let mut payload = vec![0_u8; declared];
        client.read_exact(&mut payload).await.map_err(|error| error.to_string())?;
        let mut full = Vec::with_capacity(IPC_FRAME_HEADER_BYTES + declared);
        full.extend_from_slice(&header);
        full.extend_from_slice(&payload);
        decode_frame(&full).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| format!("bridge request timed out after {} ms", request_timeout.as_millis()))?
}

fn ensure_response_id(response: &IpcMessage, expected: &str) -> Result<(), String> {
    if response.id == expected {
        Ok(())
    } else {
        Err(format!(
            "response id mismatch: expected {expected}, received {}",
            response.id
        ))
    }
}

fn submission_unknown(
    session_id: &str,
    request_id: &str,
    error: impl std::fmt::Display,
) -> String {
    format!("SUBMISSION_UNKNOWN|{session_id}|{request_id}|{error}")
}

fn transport_id(prefix: &str) -> String {
    format!("native-{prefix}-{}", uuid::Uuid::new_v4())
}

fn submit_timeout() -> Result<Duration, String> {
    let millis = env::var("DSH_SELECTION_BRIDGE_TIMEOUT_MS")
        .ok()
        .map(|value| value.parse::<u64>())
        .transpose()
        .map_err(|_| "DSH_SELECTION_BRIDGE_TIMEOUT_MS must be a positive integer".to_owned())?
        .unwrap_or(DEFAULT_SUBMIT_TIMEOUT_MS);
    if millis == 0 || millis > 60_000 {
        return Err("DSH_SELECTION_BRIDGE_TIMEOUT_MS must be an integer from 1 to 60000".to_owned());
    }
    Ok(Duration::from_millis(millis))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_contract_matches_the_main_bridge() {
        let previous = env::var("DSH_SELECTION_BRIDGE_TIMEOUT_MS").ok();
        env::set_var("DSH_SELECTION_BRIDGE_TIMEOUT_MS", "0");
        assert!(submit_timeout().is_err());
        if let Some(previous) = previous {
            env::set_var("DSH_SELECTION_BRIDGE_TIMEOUT_MS", previous);
        } else {
            env::remove_var("DSH_SELECTION_BRIDGE_TIMEOUT_MS");
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn writes_the_exact_authorized_material_to_the_v4_submit_frame() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::windows::named_pipe::ServerOptions;

        async fn read_message(
            server: &mut tokio::net::windows::named_pipe::NamedPipeServer,
        ) -> IpcMessage {
            let mut header = [0_u8; IPC_FRAME_HEADER_BYTES];
            server.read_exact(&mut header).await.unwrap();
            let declared = u32::from_be_bytes(header) as usize;
            let mut payload = vec![0_u8; declared];
            server.read_exact(&mut payload).await.unwrap();
            let mut frame = Vec::with_capacity(IPC_FRAME_HEADER_BYTES + declared);
            frame.extend_from_slice(&header);
            frame.extend_from_slice(&payload);
            decode_frame(&frame).unwrap()
        }

        async fn write_message(
            server: &mut tokio::net::windows::named_pipe::NamedPipeServer,
            message: &IpcMessage,
        ) {
            let frame = encode_frame(message).unwrap();
            server.write_all(&frame).await.unwrap();
            server.flush().await.unwrap();
        }

        let endpoint = format!(
            r"\\.\pipe\dsh-selection-companion-ec05-{}",
            uuid::Uuid::new_v4()
        );
        let previous_endpoint = env::var("DSH_SELECTION_COMPANION_PIPE").ok();
        env::set_var("DSH_SELECTION_COMPANION_PIPE", &endpoint);

        let mut server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&endpoint)
            .unwrap();
        let server_task = tokio::spawn(async move {
            server.connect().await.unwrap();
            let hello = read_message(&mut server).await;
            write_message(
                &mut server,
                &IpcMessage {
                    protocol: IPC_PROTOCOL_VERSION,
                    id: hello.id,
                    type_name: "bridge.hello.result".to_owned(),
                    payload: serde_json::json!({
                        "protocol": IPC_PROTOCOL_VERSION,
                        "server": { "name": "ec05-test", "version": "0.1.0" },
                        "capabilities": ["session"]
                    }),
                },
            )
            .await;

            let submit = read_message(&mut server).await;
            let response_id = submit.id.clone();
            write_message(
                &mut server,
                &IpcMessage {
                    protocol: IPC_PROTOCOL_VERSION,
                    id: response_id,
                    type_name: "session.submitted".to_owned(),
                    payload: serde_json::json!({
                        "accepted": true,
                        "requestId": "request-ec05",
                        "messageId": "message-ec05",
                        "delivery": "queued",
                        "duplicate": false
                    }),
                },
            )
            .await;
            submit
        });

        let material = serde_json::json!({
            "snapshotId": "snapshot-ec05",
            "revision": 5,
            "capturedAt": 5_000,
            "selection": { "text": "fixed selection" },
            "source": { "kind": "browser", "app": "Chrome" },
            "authorizedScope": "local",
            "actualScope": "local",
            "completeness": "partial",
            "truncated": true,
            "context": {
                "before": "EC05_AUTHORIZED_BEFORE",
                "after": "EC05_AUTHORIZED_AFTER"
            }
        });

        let result = bridge_submit_prompt(
            Some("session-ec05".to_owned()),
            "fixed canonical prompt".to_owned(),
            "request-ec05".to_owned(),
            material.clone(),
        )
        .await
        .unwrap();
        let submitted = server_task.await.unwrap();

        if let Some(previous) = previous_endpoint {
            env::set_var("DSH_SELECTION_COMPANION_PIPE", previous);
        } else {
            env::remove_var("DSH_SELECTION_COMPANION_PIPE");
        }

        assert_eq!(result.session_id, "session-ec05");
        assert_eq!(submitted.type_name, "session.submit");
        assert_eq!(submitted.payload["material"], material);
        assert_eq!(submitted.payload["material"]["authorizedScope"], "local");
        assert_eq!(
            submitted.payload["material"]["context"]["before"],
            "EC05_AUTHORIZED_BEFORE"
        );
    }
}
