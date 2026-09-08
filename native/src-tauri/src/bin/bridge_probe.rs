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
        let ping = IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: "probe-ping".to_owned(),
            type_name: "bridge.ping".to_owned(),
            payload: serde_json::json!({ "sentAt": 1 }),
        };
        if exchange(&mut requests, &ping).await?.type_name != "bridge.pong" {
            return Err("ping did not return bridge.pong".to_owned());
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
    println!("PASS: 100 ordered events plus concurrent ping and submit");
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("SKIP: bridge_probe requires Windows named pipes");
    std::process::exit(2);
}
