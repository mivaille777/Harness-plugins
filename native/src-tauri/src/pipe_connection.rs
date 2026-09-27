use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{broadcast, mpsc, oneshot, watch, Mutex};
use tokio::time::timeout;

use crate::protocol::{
    decode_frame, encode_frame, IpcMessage, IPC_FRAME_HEADER_BYTES, IPC_MAX_FRAME_BYTES,
};

const MAX_PENDING_REQUESTS: usize = 128;
const OUTBOUND_QUEUE_CAPACITY: usize = 128;
const EVENT_QUEUE_CAPACITY: usize = 64;

type Response = Result<IpcMessage, String>;

#[derive(Clone)]
pub struct NamedPipeConnection {
    inner: Arc<ConnectionInner>,
}

struct ConnectionInner {
    writer: mpsc::Sender<Vec<u8>>,
    tracker: Arc<RequestTracker>,
    alive: Arc<AtomicBool>,
    shutdown: watch::Sender<bool>,
    events: broadcast::Sender<IpcMessage>,
}

#[derive(Default)]
struct RequestTracker {
    pending: Mutex<HashMap<String, oneshot::Sender<Response>>>,
}

impl RequestTracker {
    async fn register(
        &self,
        id: String,
        response: oneshot::Sender<Response>,
    ) -> Result<(), String> {
        let mut pending = self.pending.lock().await;
        if pending.contains_key(&id) {
            return Err(format!("duplicate pending pipe request id: {id}"));
        }
        if pending.len() >= MAX_PENDING_REQUESTS {
            return Err(format!(
                "pipe request limit exceeded ({MAX_PENDING_REQUESTS})"
            ));
        }
        pending.insert(id, response);
        Ok(())
    }

    async fn cancel(&self, id: &str) {
        self.pending.lock().await.remove(id);
    }

    async fn resolve(&self, message: IpcMessage) -> Result<(), IpcMessage> {
        let sender = self.pending.lock().await.remove(&message.id);
        let Some(sender) = sender else {
            return Err(message);
        };
        if let Err(response) = sender.send(Ok(message)) {
            if let Ok(response) = response {
                return Err(response);
            }
        }
        Ok(())
    }

    async fn reject_all(&self, reason: &str) {
        let pending = std::mem::take(&mut *self.pending.lock().await);
        for (_, responder) in pending {
            let _ = responder.send(Err(reason.to_owned()));
        }
    }
}

impl NamedPipeConnection {
    pub fn start<T>(stream: T, request_timeout: Duration) -> Self
    where
        T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        Self::start_with_events(stream, request_timeout).0
    }

    pub fn start_with_events<T>(
        stream: T,
        request_timeout: Duration,
    ) -> (Self, broadcast::Receiver<IpcMessage>)
    where
        T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (reader, writer) = tokio::io::split(stream);
        let (writer_tx, writer_rx) = mpsc::channel(OUTBOUND_QUEUE_CAPACITY);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let (events_tx, _) = broadcast::channel(EVENT_QUEUE_CAPACITY);
        let events_rx = events_tx.subscribe();
        let tracker = Arc::new(RequestTracker::default());
        let alive = Arc::new(AtomicBool::new(true));

        tokio::spawn(writer_loop(
            writer,
            writer_rx,
            shutdown_rx.clone(),
            tracker.clone(),
            alive.clone(),
            shutdown_tx.clone(),
            request_timeout,
        ));
        tokio::spawn(reader_loop(
            reader,
            shutdown_rx,
            tracker.clone(),
            alive.clone(),
            shutdown_tx.clone(),
            events_tx.clone(),
        ));

        let connection = Self {
            inner: Arc::new(ConnectionInner {
                writer: writer_tx,
                tracker,
                alive,
                shutdown: shutdown_tx,
                events: events_tx,
            }),
        };
        (connection, events_rx)
    }

    pub fn is_alive(&self) -> bool {
        self.inner.alive.load(Ordering::Acquire)
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<IpcMessage> {
        self.inner.events.subscribe()
    }

    pub async fn request(&self, message: &IpcMessage, request_timeout: Duration) -> Response {
        if !self.is_alive() {
            return Err("named pipe connection is closed".to_owned());
        }
        let frame = encode_frame(message).map_err(|error| error.to_string())?;
        let request_id = message.id.clone();
        let (response_tx, response_rx) = oneshot::channel();
        self.inner
            .tracker
            .register(request_id.clone(), response_tx)
            .await?;

        let result = timeout(request_timeout, async {
            self.inner
                .writer
                .send(frame)
                .await
                .map_err(|_| "named pipe writer has stopped".to_owned())?;
            response_rx
                .await
                .map_err(|_| "named pipe response channel closed".to_owned())?
        })
        .await;

        match result {
            Ok(response) => response,
            Err(_) => {
                self.inner.tracker.cancel(&request_id).await;
                Err(format!(
                    "bridge request timed out after {} ms",
                    request_timeout.as_millis()
                ))
            }
        }
    }

    pub async fn close(&self, reason: &str) {
        self.inner.alive.store(false, Ordering::Release);
        self.inner.shutdown.send_replace(true);
        self.inner.tracker.reject_all(reason).await;
    }
}

impl Drop for ConnectionInner {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Release);
        self.shutdown.send_replace(true);
        let tracker = self.tracker.clone();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                tracker
                    .reject_all("named pipe connection was dropped")
                    .await;
            });
        }
    }
}

async fn writer_loop<W>(
    mut writer: W,
    mut incoming: mpsc::Receiver<Vec<u8>>,
    mut shutdown: watch::Receiver<bool>,
    tracker: Arc<RequestTracker>,
    alive: Arc<AtomicBool>,
    shutdown_tx: watch::Sender<bool>,
    write_timeout: Duration,
) where
    W: AsyncWrite + Unpin,
{
    loop {
        if *shutdown.borrow() {
            break;
        }
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() { break; }
            }
            frame = incoming.recv() => {
                let Some(frame) = frame else { break; };
                let result = timeout(write_timeout, async {
                    writer.write_all(&frame).await.map_err(|error| error.to_string())?;
                    writer.flush().await.map_err(|error| error.to_string())
                }).await;
                let error = match result {
                    Ok(Ok(())) => continue,
                    Ok(Err(error)) => format!("named pipe write failed: {error}"),
                    Err(_) => format!("named pipe write timed out after {} ms", write_timeout.as_millis()),
                };
                close_connection(&tracker, &alive, &shutdown_tx, &error).await;
                break;
            }
        }
    }
}

async fn reader_loop<R>(
    mut reader: R,
    mut shutdown: watch::Receiver<bool>,
    tracker: Arc<RequestTracker>,
    alive: Arc<AtomicBool>,
    shutdown_tx: watch::Sender<bool>,
    events: broadcast::Sender<IpcMessage>,
) where
    R: AsyncRead + Unpin,
{
    loop {
        if *shutdown.borrow() {
            break;
        }
        let result = tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() { break; }
                continue;
            }
            message = read_message(&mut reader) => message,
        };
        match result {
            Ok(message) => match tracker.resolve(message).await {
                Ok(()) => {}
                Err(message) if is_event_message(&message.type_name) => {
                    let _ = events.send(message);
                }
                Err(message) => {
                    eprintln!(
                        "[native-bridge] orphan response id={} type={}",
                        message.id, message.type_name
                    );
                }
            },
            Err(error) => {
                close_connection(
                    &tracker,
                    &alive,
                    &shutdown_tx,
                    &format!("named pipe read failed: {error}"),
                )
                .await;
                break;
            }
        }
    }
}

async fn close_connection(
    tracker: &RequestTracker,
    alive: &AtomicBool,
    shutdown: &watch::Sender<bool>,
    reason: &str,
) {
    alive.store(false, Ordering::Release);
    shutdown.send_replace(true);
    tracker.reject_all(reason).await;
}

fn is_event_message(type_name: &str) -> bool {
    matches!(
        type_name,
        "agent.event" | "session.event" | "bridge.status" | "selection.event"
    )
}

async fn read_message<R>(reader: &mut R) -> Result<IpcMessage, String>
where
    R: AsyncRead + Unpin,
{
    let mut header = [0_u8; IPC_FRAME_HEADER_BYTES];
    reader
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
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| error.to_string())?;
    let mut frame = Vec::with_capacity(IPC_FRAME_HEADER_BYTES + declared);
    frame.extend_from_slice(&header);
    frame.extend_from_slice(&payload);
    decode_frame(&frame).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::IPC_PROTOCOL_VERSION;
    use tokio::io::{duplex, AsyncWriteExt};

    fn message(id: &str, type_name: &str, payload: serde_json::Value) -> IpcMessage {
        IpcMessage {
            protocol: IPC_PROTOCOL_VERSION,
            id: id.to_owned(),
            type_name: type_name.to_owned(),
            payload,
        }
    }

    async fn write_message<W: AsyncWrite + Unpin>(writer: &mut W, message: &IpcMessage) {
        writer
            .write_all(&encode_frame(message).unwrap())
            .await
            .unwrap();
    }

    async fn write_payload<W: AsyncWrite + Unpin>(writer: &mut W, payload: &[u8]) {
        writer
            .write_all(&(payload.len() as u32).to_be_bytes())
            .await
            .unwrap();
        writer.write_all(payload).await.unwrap();
    }

    #[tokio::test]
    async fn concurrent_requests_resolve_by_id_while_events_are_dispatched_in_order() {
        let (client, mut server) = duplex(64 * 1024);
        let connection = NamedPipeConnection::start(client, Duration::from_secs(1));
        let mut events = connection.subscribe_events();
        let first = connection.clone();
        let second = connection.clone();
        let first_task = tokio::spawn(async move {
            first
                .request(
                    &message(
                        "request-first",
                        "bridge.ping",
                        serde_json::json!({"sentAt": 1}),
                    ),
                    Duration::from_secs(1),
                )
                .await
        });
        let second_task = tokio::spawn(async move {
            second
                .request(
                    &message("request-second", "selection.current", serde_json::json!({})),
                    Duration::from_secs(1),
                )
                .await
        });

        let first_request = read_message(&mut server).await.unwrap();
        let second_request = read_message(&mut server).await.unwrap();
        let mut ids = [first_request.id, second_request.id];
        ids.sort();
        assert_eq!(ids, ["request-first", "request-second"]);

        for cursor in [1, 2] {
            write_message(&mut server, &message(
                &format!("event-{cursor}"),
                "agent.event",
                serde_json::json!({
                    "sessionId": "session-test",
                    "subscriptionId": "subscription-test",
                    "event": {"kind": "status", "data": {"cursor": cursor, "persistent": false, "value": {"status": "running"}}}
                }),
            )).await;
        }
        write_message(
            &mut server,
            &message(
                "request-second",
                "selection.current.result",
                serde_json::json!({"snapshot": null}),
            ),
        )
        .await;
        write_message(
            &mut server,
            &message(
                "request-first",
                "bridge.pong",
                serde_json::json!({"sentAt": 1, "receivedAt": 2}),
            ),
        )
        .await;

        assert_eq!(first_task.await.unwrap().unwrap().type_name, "bridge.pong");
        assert_eq!(
            second_task.await.unwrap().unwrap().type_name,
            "selection.current.result"
        );
        let event_one = events.recv().await.unwrap();
        let event_two = events.recv().await.unwrap();
        assert_eq!(event_one.payload["event"]["data"]["cursor"], 1);
        assert_eq!(event_two.payload["event"]["data"]["cursor"], 2);
        connection.close("test complete").await;
    }

    #[tokio::test]
    async fn duplicate_request_ids_are_rejected_while_pending() {
        let (client, _server) = duplex(1024);
        let connection = NamedPipeConnection::start(client, Duration::from_millis(100));
        let request = message("duplicate", "bridge.ping", serde_json::json!({"sentAt": 1}));
        let first_connection = connection.clone();
        let first_request = request.clone();
        let first = tokio::spawn(async move {
            first_connection
                .request(&first_request, Duration::from_millis(80))
                .await
        });
        tokio::task::yield_now().await;

        let duplicate = connection
            .request(&request, Duration::from_millis(10))
            .await;
        assert!(duplicate
            .unwrap_err()
            .contains("duplicate pending pipe request id"));
        assert!(first.await.unwrap().unwrap_err().contains("timed out"));
    }

    #[tokio::test]
    async fn disconnect_fans_out_errors_to_all_pending_requests() {
        let (client, mut server) = duplex(4096);
        let connection = NamedPipeConnection::start(client, Duration::from_secs(1));
        let first_connection = connection.clone();
        let second_connection = connection.clone();
        let first = tokio::spawn(async move {
            first_connection
                .request(
                    &message(
                        "pending-one",
                        "bridge.ping",
                        serde_json::json!({"sentAt": 1}),
                    ),
                    Duration::from_secs(1),
                )
                .await
        });
        let second = tokio::spawn(async move {
            second_connection
                .request(
                    &message(
                        "pending-two",
                        "bridge.ping",
                        serde_json::json!({"sentAt": 2}),
                    ),
                    Duration::from_secs(1),
                )
                .await
        });
        let _ = read_message(&mut server).await.unwrap();
        let _ = read_message(&mut server).await.unwrap();
        drop(server);

        assert!(first.await.unwrap().unwrap_err().contains("read failed"));
        assert!(second.await.unwrap().unwrap_err().contains("read failed"));
        assert!(!connection.is_alive());
    }

    #[tokio::test]
    async fn timeout_removes_pending_request_and_keeps_connection_available() {
        let (client, mut server) = duplex(4096);
        let connection = NamedPipeConnection::start(client, Duration::from_millis(200));
        let first_connection = connection.clone();
        let first = tokio::spawn(async move {
            first_connection
                .request(
                    &message("late", "bridge.ping", serde_json::json!({"sentAt": 1})),
                    Duration::from_millis(20),
                )
                .await
        });
        let _ = read_message(&mut server).await.unwrap();
        assert!(first.await.unwrap().unwrap_err().contains("timed out"));
        assert!(connection.is_alive());
        assert_eq!(connection.inner.tracker.pending.lock().await.len(), 0);
        connection.close("test complete").await;
    }

    #[tokio::test]
    async fn late_response_is_orphaned_without_poisoning_the_next_request() {
        let (client, mut server) = duplex(4096);
        let connection = NamedPipeConnection::start(client, Duration::from_millis(250));
        let timed_out_connection = connection.clone();
        let timed_out = tokio::spawn(async move {
            timed_out_connection
                .request(
                    &message(
                        "late-response",
                        "bridge.ping",
                        serde_json::json!({"sentAt": 1}),
                    ),
                    Duration::from_millis(20),
                )
                .await
        });
        let _ = read_message(&mut server).await.unwrap();
        assert!(timed_out.await.unwrap().unwrap_err().contains("timed out"));

        write_message(
            &mut server,
            &message(
                "late-response",
                "bridge.pong",
                serde_json::json!({"sentAt": 1, "receivedAt": 2}),
            ),
        )
        .await;
        let next_connection = connection.clone();
        let next = tokio::spawn(async move {
            next_connection
                .request(
                    &message(
                        "next-request",
                        "bridge.ping",
                        serde_json::json!({"sentAt": 3}),
                    ),
                    Duration::from_millis(200),
                )
                .await
        });
        let next_request = read_message(&mut server).await.unwrap();
        assert_eq!(next_request.id, "next-request");
        write_message(
            &mut server,
            &message(
                "next-request",
                "bridge.pong",
                serde_json::json!({"sentAt": 3, "receivedAt": 4}),
            ),
        )
        .await;
        assert_eq!(next.await.unwrap().unwrap().id, "next-request");
        assert!(connection.is_alive());
        connection.close("test complete").await;
    }

    #[tokio::test]
    async fn malformed_json_disconnects_and_fans_out_pending_requests() {
        let (client, mut server) = duplex(4096);
        let connection = NamedPipeConnection::start(client, Duration::from_secs(1));
        let pending_connection = connection.clone();
        let pending = tokio::spawn(async move {
            pending_connection
                .request(
                    &message(
                        "malformed-pending",
                        "bridge.ping",
                        serde_json::json!({"sentAt": 1}),
                    ),
                    Duration::from_secs(1),
                )
                .await
        });
        let _ = read_message(&mut server).await.unwrap();
        write_payload(&mut server, b"not valid JSON").await;

        assert!(pending.await.unwrap().unwrap_err().contains("read failed"));
        assert!(!connection.is_alive());
    }

    #[tokio::test]
    async fn oversized_frame_disconnects_and_fans_out_pending_requests() {
        let (client, mut server) = duplex(4096);
        let connection = NamedPipeConnection::start(client, Duration::from_secs(1));
        let pending_connection = connection.clone();
        let pending = tokio::spawn(async move {
            pending_connection
                .request(
                    &message(
                        "oversized-pending",
                        "bridge.ping",
                        serde_json::json!({"sentAt": 1}),
                    ),
                    Duration::from_secs(1),
                )
                .await
        });
        let _ = read_message(&mut server).await.unwrap();
        server
            .write_all(&((IPC_MAX_FRAME_BYTES as u32) + 1).to_be_bytes())
            .await
            .unwrap();

        assert!(pending.await.unwrap().unwrap_err().contains("read failed"));
        assert!(!connection.is_alive());
    }
}
