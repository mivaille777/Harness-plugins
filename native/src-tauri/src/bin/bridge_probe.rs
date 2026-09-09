#[cfg(windows)]
use dsh_selection_companion_native::protocol::{
    encode_frame, IpcMessage, IPC_FRAME_HEADER_BYTES, IPC_MAX_FRAME_BYTES, IPC_PROTOCOL_VERSION,
};
#[cfg(windows)]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[cfg(windows)]
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};

#[cfg(windows)]
async fn open_pipe(endpoint: &str) -> Result<NamedPipeClient, String> {
    for attempt in 0..40 {
        match ClientOptions::new().open(endpoint) {
            Ok(client) => return Ok(client),
            Err(error) if matches!(error.raw_os_error(), Some(2 | 231)) && attempt < 39 => {
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("named pipe did not become available".to_owned())
}

#[cfg(windows)]
async fn read_message(client: &mut NamedPipeClient) -> Result<IpcMessage, String> {
    let mut header = [0_u8; IPC_FRAME_HEADER_BYTES];
    client
        .read_exact(&mut header)
        .await
        .map_err(|error| error.to_string())?;
    let declared = u32::from_be_bytes(header) as usize;
    if declared > IPC_MAX_FRAME_BYTES {
        return Err(format!("frame exceeds {IPC_MAX_FRAME_BYTES} bytes"));
    }
    let mut body = vec![0_u8; declared];
    client
        .read_exact(&mut body)
        .await
        .map_err(|error| error.to_string())?;
    let mut frame = Vec::with_capacity(IPC_FRAME_HEADER_BYTES + declared);
    frame.extend_from_slice(&header);
    frame.extend_from_slice(&body);
    dsh_selection_companion_native::protocol::decode_frame(&frame)
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
async fn send(client: &mut NamedPipeClient, message: &IpcMessage) -> Result<(), String> {
    let frame = encode_frame(message).map_err(|error| error.to_string())?;
    client
        .write_all(&frame)
        .await
        .map_err(|error| error.to_string())?;
    client.flush().await.map_err(|error| error.to_string())
}

#[cfg(windows)]
async fn exchange(
    client: &mut NamedPipeClient,
    message: &IpcMessage,
) -> Result<IpcMessage, String> {
    send(client, message).await?;
    let response = read_message(client).await?;
    if response.id != message.id {
        return Err(format!(
            "response id mismatch: expected {}, received {}",
            message.id, response.id
        ));
    }
    Ok(response)
}

#[cfg(windows)]
fn hello(id: &str) -> IpcMessage {
    IpcMessage {
        protocol: IPC_PROTOCOL_VERSION,
        id: id.to_owned(),
        type_name: "bridge.hello".to_owned(),
        payload: serde_json::json!({
            "client": { "name": "bridge-probe", "version": "0.1.0", "platform": "windows" },
            "supportedProtocols": [IPC_PROTOCOL_VERSION]
        }),
    }
}

#[cfg(windows)]
#[tokio::main]
async fn main() -> Result<(), String> {
    let endpoint = std::env::var("DSH_SELECTION_COMPANION_INTEGRATION_PIPE")
        .map_err(|_| "DSH_SELECTION_COMPANION_INTEGRATION_PIPE is required".to_owned())?;
    let mut events = open_pipe(&endpoint).await?;
    if exchange(&mut events, &hello("probe-event-hello"))
        .await?
        .type_name
        != "bridge.hello.result"
    {
        return Err("event pipe hello failed".to_owned());
    }
    let subscribe = IpcMessage {
        protocol: IPC_PROTOCOL_VERSION,
        id: "probe-subscription".to_owned(),
        type_name: "session.subscribe".to_owned(),
        payload: serde_json::json!({ "sessionId": "session-integration", "cursor": 0 }),
    };
    send(&mut events, &subscribe).await?;
    let acknowledged = read_message(&mut events).await?;
    if acknowledged.type_name != "session.subscribed"
        || acknowledged.id != subscribe.id
        || acknowledged
            .payload
            .get("subscriptionId")
            .and_then(serde_json::Value::as_str)
            != Some(subscribe.id.as_str())
    {
        return Err(format!(
            "invalid subscription acknowledgement: {acknowledged:?}"
        ));
    }

    let mut requests = open_pipe(&endpoint).await?;
    exchange(&mut requests, &hello("probe-request-hello")).await?;
    let event_work = async {
        for expected in 1_u64..=100 {
            let message = read_message(&mut events).await?;
            let cursor = message
                .payload
                .pointer("/event/data/cursor")
                .and_then(serde_json::Value::as_u64);
            let subscription = message
                .payload
                .get("subscriptionId")
                .and_then(serde_json::Value::as_str);
            if message.type_name != "agent.event"
                || cursor != Some(expected)
                || subscription != Some("probe-subscription")
            {
                return Err(format!("unexpected event {expected}: {message:?}"));
            }
        }
        Ok::<(), String>(())
    };
    let request_work = async {
        let selection_update = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: "probe-selection-update".to_owned(),
            type_name: "selection.update".to_owned(),
            payload: serde_json::json!({
                "snapshot": {
                    "id": "selection-integration",
                    "revision": 1,
                    "capturedAt": 1000,
                    "selection": { "text": "Deterministic integration selection." },
                    "source": { "kind": "browser", "app": "Bridge probe" },
                    "context": {
                        "before": "Before integration selection.",
                        "after": "After integration selection.",
                        "pageText": "Page integration context.",
                        "pageAvailable": true
                    },
                    "capabilities": {
                        "localContext": true,
                        "sectionContext": false,
                        "pageContext": true,
                        "screenshot": false
                    },
                    "provider": "bridge-probe",
                    "confidence": 1.0
                }
            }),
        };
        if exchange(&mut requests, &selection_update).await?.type_name != "selection.updated" {
            return Err("selection update did not return selection.updated".to_owned());
        }
        let selection_expand = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: "probe-selection-expand".to_owned(),
            type_name: "selection.expand".to_owned(),
            payload: serde_json::json!({
                "snapshotId": "selection-integration",
                "scope": "local"
            }),
        };
        let expanded = exchange(&mut requests, &selection_expand).await?;
        if expanded.type_name != "selection.expanded"
            || expanded
                .payload
                .get("revision")
                .and_then(serde_json::Value::as_u64)
                != Some(1)
            || expanded
                .payload
                .get("completeness")
                .and_then(serde_json::Value::as_str)
                != Some("complete")
            || expanded
                .payload
                .pointer("/context/before")
                .and_then(serde_json::Value::as_str)
                != Some("Before integration selection.")
        {
            return Err(format!(
                "selection.expand did not return the bounded fixture: {expanded:?}"
            ));
        }
        let ping = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: "probe-ping".to_owned(),
            type_name: "bridge.ping".to_owned(),
            payload: serde_json::json!({ "sentAt": 1 }),
        };
        if exchange(&mut requests, &ping).await?.type_name != "bridge.pong" {
            return Err("ping did not return bridge.pong".to_owned());
        }
        let list = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: "probe-session-list".to_owned(),
            type_name: "session.list".to_owned(),
            payload: serde_json::json!({}),
        };
        let listed = exchange(&mut requests, &list).await?;
        if listed.type_name != "session.list.result"
            || listed
                .payload
                .pointer("/sessions/0/id")
                .and_then(serde_json::Value::as_str)
                != Some("session-integration")
        {
            return Err(format!(
                "session.list did not return the fixture session: {listed:?}"
            ));
        }
        let create = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: "probe-session-create".to_owned(),
            type_name: "session.create".to_owned(),
            payload: serde_json::json!({ "cwd": "D:/integration-fixture" }),
        };
        let created = exchange(&mut requests, &create).await?;
        if created.type_name != "session.created"
            || created
                .payload
                .get("sessionId")
                .and_then(serde_json::Value::as_str)
                != Some("session-integration")
        {
            return Err(format!(
                "session.create did not return the fixture session: {created:?}"
            ));
        }
        let history = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: "probe-session-history".to_owned(),
            type_name: "session.history".to_owned(),
            payload: serde_json::json!({ "sessionId": "session-integration", "limit": 32 }),
        };
        let history_result = exchange(&mut requests, &history).await?;
        if history_result.type_name != "session.history.result"
            || history_result
                .payload
                .pointer("/entries/1/text")
                .and_then(serde_json::Value::as_str)
                != Some("Integration answer")
            || history_result
                .payload
                .get("capturedThroughCursor")
                .and_then(serde_json::Value::as_u64)
                != Some(2)
        {
            return Err(format!(
                "session.history did not return the durable fixture: {history_result:?}"
            ));
        }
        let submit = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: "probe-submit".to_owned(),
            type_name: "session.submit".to_owned(),
            payload: serde_json::json!({
                "sessionId": "session-integration",
                "requestId": "request-integration",
                "mode": "queue",
                "content": [{ "type": "text", "text": "deterministic integration fixture" }],
                "material": {
                    "snapshotId": "snapshot-integration",
                    "revision": 1,
                    "capturedAt": 1000,
                    "selection": { "text": "Deterministic integration selection." },
                    "source": { "kind": "browser", "app": "Bridge probe" },
                    "authorizedScope": "selection",
                    "actualScope": "selection",
                    "completeness": "complete"
                }
            }),
        };
        if exchange(&mut requests, &submit).await?.type_name != "session.submitted" {
            return Err("submit did not return session.submitted".to_owned());
        }
        Ok::<(), String>(())
    };
    tokio::try_join!(event_work, request_work)?;
    println!("PASS: 100 ordered events plus selection expansion, ping, list, create, history, and submit");
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("SKIP: bridge_probe requires Windows named pipes");
    std::process::exit(2);
}
