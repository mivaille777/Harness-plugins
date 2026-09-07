# R03 request identity and recovery evidence

Date: 2026-09-07

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Verification commit: the commit that introduces this evidence file

Environment: Windows, Node.js `v24.11.1`, pnpm `11.7.0`, rustc and cargo `1.97.1`

## Implemented behavior

Protocol V2 rejects V1 peers and uses a distinct default pipe. Logical request, transport, message, turn, step, and subscription identities are separate. Concurrent identical submissions share one in-flight Promise. Content, delivery-mode, and cross-session reuse conflicts fail. The durable message source records the request identity, delivery mode, and content digest so a restarted service can return the existing message receipt.

The event projection retains every request associated with a shared turn. Native submit and subscription ids use UUIDs. A lost or invalid submit response enters `submission-unknown`, closes the request connection, and permits only an exact retry with the saved logical identity. Completion and cancellation races cannot move a terminal request back to streaming or error.

## Automated and integration evidence

| Evidence | Command | Result |
|---|---|---|
| Session service and bridge routing | `pnpm test:session` | PASS, exit 0, 2 files and 19 tests |
| Durable turn projection | `pnpm test:session:replay` | PASS, exit 0, 1 file and 3 tests |
| Session framing and lifecycle | `pnpm test:session:transport` | PASS, exit 0, 1 file and 6 tests |
| Lens, request projection, and Native API | `pnpm test:lens:session` | PASS, exit 0, 3 files and 26 tests |
| Root TypeScript program | `pnpm typecheck` | PASS, exit 0 |
| Cross-language protocol, Native build, and Rust | `pnpm test:contract` | PASS, exit 0; 11 protocol tests, 24 frontend modules, 24 Rust tests |
| Real Windows Node/Rust named pipe | `pnpm test:bridge:integration` | PASS, exit 0; 100 ordered events with concurrent ping/submit and zero remaining clients/listeners |
| Rust formatting | `cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check` | PASS, exit 0 |

The behavior tests cover concurrent calls past the configured retention interval while still pending, cross-session and content/mode conflicts, durable recovery after service reconstruction, memory receipt expiry, multiple requests in one steer turn, shared-turn Lens projection, UUID uniqueness, duplicate action locking, exact retry after an unknown response, a real Windows pipe closing after it reads the submit frame, terminal late tokens, and both resolved and rejected late cancellation replies.

## Evidence limits

Evidence is U/I level plus W-level named-pipe transport. The service restart case reconstructs an Agent from a durable-event fixture; it does not restart a real dsh process or inspect an actual session directory. No real model, browser capture, visible Tauri window, scoped selection tool, approval UI, or screenshot was exercised. R04 through R07 own those missing acceptance paths.
