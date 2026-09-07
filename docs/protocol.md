# Protocol contract

The native companion and the Harness bundle exchange Protocol V2 messages through a length-prefixed UTF-8 JSON stream. V2 requires the durable submission receipt and shared-turn request identity fields introduced by R03; it does not negotiate with the earlier V1 schema. Every message has a protocol version, a transport correlation ID, a known message type, and an object payload. Both implementations reject unknown fields at the IPC boundary.

## Message availability

The protocol schema describes messages that native and Harness components can exchange. A valid schema does not make an operation available. The Harness bridge advertises its available operations during bridge.hello and rejects valid but unavailable operations with BRIDGE_UNAVAILABLE.

The envelope ID associates one transport request with its response. For `session.subscribe`, the same id becomes the acknowledged `subscriptionId` and appears on every event from that reader. A `session.submit.payload.requestId` is a separate logical request identity generated before the first send. Recovery reuses that logical id and exact content while every transport attempt has a new envelope id.

## Selection snapshots

A selection.update message carries one immutable snapshot. The snapshot ID and revision identify the selected material; a higher revision for the same ID replaces that cache record, while a different ID can become current without changing an older record. The capture timestamp, provider, source, context, capability flags, and optional geometry travel with the selected text.

The current protocol supports selection, local, section, and page expansion scopes. A future expansion implementation must bind the requested scope to the original snapshot and source before returning content. It must report an unavailable or changed source instead of joining material from a different document.

## Session and event messages

Session list, create, submit, subscribe, cancel, and agent event messages are schema-validated in both implementations and advertised by the session bridge. A successful `session.submitted` payload has `accepted: true`, the logical `requestId`, the durable Harness `messageId`, `delivery` equal to `queued` or `steered`, and a `duplicate` flag. A request id reused with another session, content digest, or delivery mode is rejected. If the client cannot validate a response after the submit frame was written, it treats the result as unknown and may recover only by resending the same logical request.

Each agent event contains `cursor`, `persistent`, and `value`. Only an accepted event with `persistent: true` advances a client's recovery cursor; agent status notifications carry the current cursor for context with `persistent: false`. An `agent.event.requestId` is present only when one persisted `selection-companion` source message owns the turn. `agent.event.requestIds` lists every known companion request associated with a shared turn. Clients must not infer a missing or exclusive owner from event order.

Subscription setup installs the live listener before reading history, buffers arrivals during that read, and merges snapshot plus live events by durable sequence. Duplicates are removed. A cursor beyond the high-water mark, unavailable history before the requested cursor, or a sequence gap fails visibly; the client resumes only from its last accepted durable cursor.

## Shared fixtures

The valid JSON fixtures in tests/protocol describe messages that both TypeScript and Rust must accept. The files in tests/protocol/invalid describe inputs that both implementations must reject. Run the cross-language contract check from the repository root:

~~~powershell
pnpm test:contract
~~~

This command builds the Tauri frontend before Rust tests because the Tauri compile-time configuration requires native/dist. Add a fixture whenever a new message or an invalid boundary condition becomes part of the protocol.
