# Harness session integration

T05 targets `dsh` `0.1.1-rc.2` or a compatible runtime exporting `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-agent-default-model`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-session`, and `@deepseek-ai/dsh-session-query`.
The plugin declares these as peers and fails to load when the required Harness services are absent.

`SelectionCompanionSessionService` creates or resumes normal Harness agents, reads durable session summaries through `sessionQuery`, and sends a normal `createUserMessage` with the durable source `{ kind: 'selection-companion', requestId }`.
It owns neither an LLM client nor a second conversation history.
The exact prompt text, including the fixed selection and user action, is therefore recorded in the Harness `user/message` event and can be reconstructed from the session log.

The native Lens sends only explicit user actions.
It creates a Harness session on the first action and reuses its returned id for later prompts.
Selected page content is labelled as untrusted reference data in the user prompt; it cannot change harness permissions or instructions.

`queue` maps to Harness `agent.followup`; `steer` maps to `agent.steer` and is available only to a caller that explicitly selects that delivery mode.
Repeated `requestId` values are idempotent for five minutes; a repeated id for another session fails.
`session.cancel` calls the host's documented user cancellation operation.

Each submitted message uses the merge-extensible durable source `{ kind: 'selection-companion', requestId }`.
The subscription projects a request id only after the persisted `turn/start` and that exact source message establish a turn association.
It applies that association to chunks, assistant messages, tool events, and `turn/end`, then discards it.
An event outside that durable association has no request id, so a Lens must ignore it for a selected request instead of assigning it to the most recent submission.
On reconnect the service reads the whole log to rebuild those associations before replaying only events after the acknowledged cursor.

The bridge also implements session list, create, submit, subscribe, and cancel messages.
Subscriptions project durable session events and status events with a session id and cursor.
The native client opens one dedicated named-pipe connection for each subscribed session.
Its request/reply connection is never read by an event task, so a reply cannot race an `agent.event` frame.
The native transport confirms `session.subscribed` before reading events and emits each accepted event as Tauri's `session-agent-event` application event.
Replacing a session subscription aborts the earlier reader, and bridge disconnect aborts every active reader.
The Lens subscribes after each accepted request and renders text only from an event carrying both its active session id and request id. It offers a session-only stop action and preserves its fixed selection and draft while a response arrives. It does not project tool approvals yet.
Completing the user flow still requires reconnect cursor persistence, approval presentation, and an interactive Windows test.

The published `@deepseek-ai/dsh-tools@0.1.1-rc.2` package exists and the installed Agent API provides creation/resume `setup` for scoped composition. The plugin has not integrated that package or provided `selection_current` and `selection_read_context`; see [session-tools.md](session-tools.md).

The current implementation is not fully verified: replay can miss events between storage reads and listener registration, one turn's request association can be overwritten, and Lens completion/cancellation handling needs correction. [The integration development plan](harness-integration-development-plan.md) defines the remaining fixes, tests, and acceptance criteria; the paragraphs above describe the implemented paths rather than guarantees for those uncovered cases.

Run the available checks from the repository root:

```powershell
pnpm test:session
pnpm test:session:replay
pnpm test:session:transport
pnpm test:protocol
pnpm --dir native test
pnpm --dir native build
cargo check --manifest-path native/src-tauri/Cargo.toml
pnpm test:session:e2e
```

The first five commands run without a model key.
`test:session:e2e` currently contains only a message and an unconditional exit code 2. It neither checks credentials nor launches an isolated profile; R07 of the development plan replaces it with an actual runner.
It is not a passing substitute for a real model path.
