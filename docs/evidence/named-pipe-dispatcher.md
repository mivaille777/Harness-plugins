# P0-6 Named Pipe Dispatcher

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/named-pipe-dispatcher`

## Delivered

- Split each request pipe into a bounded writer queue and an independent reader loop. Requests register `request id → oneshot responder` and can complete out of order without holding the bridge state mutex during I/O.
- Dispatch `agent.event`, `session.event`, `bridge.status`, and `selection.event` through a broadcast event channel and publish those messages to the Tauri `native-bridge-event` event. Session subscriptions continue on their dedicated pipe and reject gaps in persistent event cursors.
- Add per-request timeout, duplicate pending-ID rejection, a 128-request cap, disconnect fan-out, orphan response logging, bounded frame validation, and explicit close behavior.
- Reconnect under a separate connection lock and complete `bridge.hello` before installing the replacement connection. Each retry of selection update/expand gets a fresh transport ID so a late response cannot be mistaken for the retry.
- Preserve the existing `selection.current` request/response contract.

## Automated verification

| Command | Result |
|---|---|
| `cargo test --manifest-path native/src-tauri/Cargo.toml` | PASS; 76 unit tests and 7 integration tests |
| `rustfmt --edition 2021 --check native/src-tauri/src/bridge.rs native/src-tauri/src/pipe_connection.rs native/src-tauri/src/lib.rs` | PASS |
| `git diff --check` | PASS |

Coverage includes concurrent requests with interleaved ordered events, timeout, late response, duplicate IDs, disconnect fan-out, malformed JSON, oversized frame declarations, reconnect plus hello, `selection.current`, and keeping status/cancel requests responsive while ping is pending.

The workspace-wide `cargo fmt --check` still reports existing formatting differences in `native/src-tauri/src/bin/pipeline_probe.rs` and `native/src-tauri/src/bin/uia_probe.rs`; those unrelated files were left unchanged.

## Runtime limits

- The native bridge publishes generic events as `native-bridge-event`; no Lens UI consumer is added in this phase.
- No live Harness Agent streaming session was run. The pipe actor and reconnect behavior are covered with in-memory streams and a Windows named-pipe server fixture.
