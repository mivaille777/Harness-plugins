# Harness session integration

T05 targets `dsh` `0.1.1-rc.2` or a compatible runtime exporting `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-agent-default-model`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-session`, and `@deepseek-ai/dsh-session-query`.
The plugin declares these as peers and fails to load when the required Harness services are absent.

`SelectionCompanionSessionService` creates or resumes normal Harness agents, reads durable session summaries through `sessionQuery`, and sends a normal `createUserMessage` with the durable source `{ kind: 'selection-companion', requestId, deliveryMode, contentDigest }`.
It owns neither an LLM client nor a second conversation history.
The exact prompt text, including the fixed selection and user action, is therefore recorded in the Harness `user/message` event and can be reconstructed from the session log.

The native Lens sends only explicit user actions.
It creates a Harness session on the first action and reuses its returned id for later prompts.
Selected page content is labelled as untrusted reference data in the user prompt; it cannot change harness permissions or instructions.

`queue` maps to Harness `agent.followup`; `steer` maps to `agent.steer` and is available only to a caller that explicitly selects that delivery mode.
The Lens generates a UUID logical request id before its first send and reuses it only for recovery of that exact prompt. Rust generates separate UUIDs for transport requests. A successful submit returns the logical request id, the Harness message id, the accepted delivery operation, and whether durable history proved that the request already existed.
The service records a shared in-flight Promise before its first asynchronous operation. Concurrent calls with the same request id, session, content, and delivery mode therefore receive the same result and execute one host submission. Reusing an id for another session, different content, or another delivery mode fails explicitly.
An accepted in-memory receipt remains for five minutes after acceptance; pending work does not expire during that period calculation. After the receipt expires or the service restarts, the service searches durable `user/message` and `agent/inbox/spliced` events for the request id and verifies the saved digest and delivery mode before returning a duplicate receipt. It does not execute again when that durable fact exists.
`session.cancel` calls the host's documented user cancellation operation.

Each submitted message uses the merge-extensible durable source `{ kind: 'selection-companion', requestId, deliveryMode, contentDigest }`.
The subscription projects a request id only after the persisted `turn/start` and that exact source message establish a turn association.
It preserves every companion request observed in one turn. Events for a turn with one request carry both `requestId` and `requestIds`; shared steer-turn output carries `requestIds` without inventing one exclusive owner. It applies that association to chunks, assistant messages, tool events, and `turn/end`, then discards it.
An event outside that durable association has no request id, so a Lens must ignore it for a selected request instead of assigning it to the most recent submission.
On reconnect the service first registers and buffers live session events, reads the durable log to rebuild associations, then merges the snapshot and buffer by sequence before replaying events after the acknowledged cursor. It removes duplicates and reports a sequence gap rather than silently skipping output. Transient agent status does not advance the durable cursor.

The bridge also implements session list, create, submit, subscribe, and cancel messages.
Subscriptions project durable session events and status events with a session id and cursor.
The native client opens one dedicated named-pipe connection for each subscribed session.
Its request/reply connection is never read by an event task, so a reply cannot race an `agent.event` frame.
The native transport confirms `session.subscribed` before reading events and emits each accepted event as Tauri's `session-agent-event` application event. Each subscription has a caller-generated id carried across JS, Rust, and Node. Replacing a session subscription aborts the earlier reader, stale generations are ignored by the Lens, completed readers remove their handles, and bridge disconnect increments a lifecycle epoch before aborting every active reader.
The Lens registers its Tauri event listener before subscribing after an accepted request. It renders text only from an event carrying its active session id and either its exclusive request id or a shared-turn `requestIds` entry, keeps turn and step identity, excludes reasoning and tool-argument deltas, and calibrates each step from its complete assistant message. Only the correlated `turn/end` event determines request completion or cancellation. Terminal projections accept later durable cursors without returning to streaming.
The stop action cancels the selected Harness session, enters `cancelling`, and waits for a host event. A late cancel reply or error cannot replace a turn that already completed. If the submit frame may have been accepted but its reply cannot be confirmed, Rust closes the request pipe and the Lens enters `submission-unknown`. Other submit actions remain locked; the recovery action sends the same session id, request id, and prompt so durable history can return the existing receipt.
Completing the user flow still requires tool registration, approval presentation, session/history navigation, a real model runner, and an interactive Windows Lens test.

The published `@deepseek-ai/dsh-tools@0.1.1-rc.2` package exists and the installed Agent API provides creation/resume `setup` for scoped composition. The plugin has not integrated that package or provided `selection_current` and `selection_read_context`; see [session-tools.md](session-tools.md).

R01 through R03 provide the answer projection, continuous event transport, and request lifecycle foundation. [The integration development plan](harness-integration-development-plan.md) defines R04 through R08 and their acceptance evidence. The current automated and Windows pipe evidence does not prove a real model, visible Tauri window, browser selection, scoped tool, approval, or restart workflow.

Run the available checks from the repository root:

```powershell
pnpm test:session
pnpm test:session:replay
pnpm test:session:transport
pnpm test:lens:session
pnpm test:protocol
pnpm --dir native test
pnpm --dir native build
cargo check --manifest-path native/src-tauri/Cargo.toml
pnpm test:session:e2e
```

The first five commands run without a model key.
`test:session:e2e` currently contains only a message and an unconditional exit code 2. It neither checks credentials nor launches an isolated profile; R07 of the development plan replaces it with an actual runner.
It is not a passing substitute for a real model path.
