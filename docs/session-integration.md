# Harness session integration

T05 targets `dsh` `0.1.1-rc.2` or a compatible runtime exporting `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-agent-default-model`, `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-session`, and `@deepseek-ai/dsh-session-query`.
The plugin declares these as peers and fails to load when the required Harness services are absent.

`SelectionCompanionSessionService` creates or resumes normal Harness agents, reads durable session summaries through `sessionQuery`, and sends a normal `createUserMessage` with `source.plugin` set to `selection-companion`.
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
The Lens shows that a request has been queued, but it does not claim that an answer has been rendered.
Completing the answer stream still requires request-to-turn correlation, reconnect cursor recovery, Lens rendering, and an interactive Windows test.

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
`test:session:e2e` currently exits with code 2 on purpose, recording that an isolated `dsh` profile, a configured provider, and Windows native-pipe evidence are still required.
It is not a passing substitute for a real model path.
