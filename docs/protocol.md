# Protocol contract

The native companion and the Harness bundle exchange Protocol V4 messages through a length-prefixed UTF-8 JSON stream. The default Windows endpoint is `\\.\pipe\dsh-selection-companion-v4`. V4 requires the durable submission receipt, shared-turn request identity fields, fixed submitted material, and explicit authorized versus actual context scope. It does not negotiate with earlier protocol versions. Every message has a protocol version, a transport correlation ID, a known message type, and an object payload. Both implementations reject unknown fields at the IPC boundary.

## Message availability

The protocol schema describes messages that native and Harness components can exchange. A valid schema does not make an operation available. The Harness bridge advertises its available operations during bridge.hello and rejects valid but unavailable operations with BRIDGE_UNAVAILABLE.

The envelope ID associates one transport request with its response. For `session.subscribe`, the same id becomes the acknowledged `subscriptionId` and appears on every event from that reader. A `session.submit.payload.requestId` is a separate logical request identity generated before the first send. Recovery reuses that logical id, exact content, and exact material while every transport attempt has a new envelope id.

## Selection snapshots

A selection.update message carries one immutable snapshot. The snapshot ID and revision identify the selected material; a higher revision for the same ID replaces that cache record, while a different ID can become current without changing an older record. The capture timestamp, provider, source, context, capability flags, and optional geometry travel with the selected text.

The current protocol supports selection, local, section, and page expansion scopes. The Harness bridge implements `selection.expand` as an explicit projection over text already captured in the immutable snapshot; it never fetches a page or joins content from another document. The response carries the snapshot revision, completeness and truncation flags, and the bridge applies bounded Unicode and UTF-8 limits before returning context. A missing capability, missing captured text or evicted snapshot becomes `BRIDGE_UNAVAILABLE`; a changed revision must be rejected by the caller before it is shown or submitted.

## Submitted material

V3 requires `session.submit.payload.material`. Its strict object contains required `snapshotId`, `revision`, `capturedAt`, non-blank `selection.text`, a source kind, `authorizedScope: "selection"`, `actualScope: "selection"`, and `completeness: "complete"`. It also permits optional language, source metadata, and a document identifier. Unknown fields, missing required fields, blank selected text, an unsupported source kind, or any scope other than `selection` are rejected by both endpoints. Optional fields may be omitted; Rust may serialize an absent optional field as `null`, which the Harness normalizes to an omitted field before persistence.

The native bridge projects the Lens snapshot to this smaller object before it submits a request. It does not include browser context before or after the selection, section or page text, capabilities, geometry, provider, or confidence. The Harness session service stores the validated material with the durable `selection-companion` message source. The submission fingerprint includes the material, so reuse of a logical request id with changed material fails instead of silently returning an unrelated receipt.

`selection.expand` remains a snapshot-context operation. It does not enlarge the material available to session tools. The Lens exposes it only after a user chooses a context scope and uses the result for a reference preview; the fixed selection remains the only submitted material until a separate authorization contract exists. V3 selection tools can only read the material whose authorized and actual scope are both `selection`.

## Session and event messages

Session list, create, submit, subscribe, cancel, and agent event messages are schema-validated in both implementations and advertised by the session bridge. A successful `session.submitted` payload has `accepted: true`, the logical `requestId`, the durable Harness `messageId`, `delivery` equal to `queued` or `steered`, and a `duplicate` flag. A request id reused with another session, content, delivery mode, or material is rejected. If the client cannot validate a response after the submit frame was written, it treats the result as unknown and may recover only by resending the same logical request, content, and material.

Each agent event contains `cursor`, `persistent`, and `value`. Only an accepted event with `persistent: true` advances a client's recovery cursor; agent status notifications carry the current cursor for context with `persistent: false`. An `agent.event.requestId` is present only when one persisted `selection-companion` source message owns the turn. `agent.event.requestIds` lists every known companion request associated with a shared turn. Clients must not infer a missing or exclusive owner from event order.

Subscription setup installs the live listener before reading history, buffers arrivals during that read, and merges snapshot plus live events by durable sequence. Duplicates are removed. A cursor beyond the high-water mark, unavailable history before the requested cursor, or a sequence gap fails visibly; the client resumes only from its last accepted durable cursor.

## Session-bound tool lookup

The V3 material does not create a global current-selection tool. When a registered selection tool executes, it finds its unique durable `tool/call` by call ID, takes that call's turn, and uses the latest preceding `selection-companion` user message in the same open turn. It rejects a missing or duplicate call ID and a turn without persisted material. A tool execution must also belong to the Agent scope in which the tool was registered. This prevents a later capture, another session, or prompt reconstruction from changing a tool result.

## Shared fixtures

The valid JSON fixtures in tests/protocol describe messages that both TypeScript and Rust must accept. The files in tests/protocol/invalid describe inputs that both implementations must reject. Run the cross-language contract check from the repository root:

~~~powershell
pnpm test:contract
~~~

This command builds the Tauri frontend before Rust tests because the Tauri compile-time configuration requires native/dist. Add a fixture whenever a new message or an invalid boundary condition becomes part of the protocol.

Run the focused material and transport checks when changing a V3 submission:

~~~powershell
pnpm test:protocol
pnpm test:session
pnpm test:session:replay
pnpm test:session:tools
pnpm test:contract
pnpm test:bridge:integration
~~~

`test:bridge:integration` requires Windows. These commands provide automated evidence only; a supported profile/model invocation and visible native interaction remain separate acceptance evidence.
