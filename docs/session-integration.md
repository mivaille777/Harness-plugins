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

The bridge also implements session list, create, submit, subscribe, and cancel messages.
Subscriptions project durable session events and status events with a session id and cursor.
The current Tauri client deliberately does not consume subscription frames yet: the existing request/reply pipe reader cannot safely multiplex streamed events with a request response.
The Lens shows that a request has been queued, but it does not claim that an answer has been rendered.
Completing the answer stream requires a dedicated multiplexed native reader, request-to-turn correlation, reconnect cursor recovery, and an interactive Windows test.

Run the available checks from the repository root:

```powershell
pnpm test:session
pnpm test:session:replay
pnpm test:protocol
pnpm --dir native test
pnpm --dir native build
cargo check --manifest-path native/src-tauri/Cargo.toml
pnpm test:session:e2e
```

The first five commands run without a model key.
`test:session:e2e` currently exits with code 2 on purpose, recording that an isolated `dsh` profile, a configured provider, and Windows native-pipe evidence are still required.
It is not a passing substitute for a real model path.
