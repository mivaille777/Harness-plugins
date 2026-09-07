# R01 Lens session projection evidence

Date: 2026-09-07

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Verification commit: this document's commit

Environment: Windows, Node.js `v24.11.1`, pnpm `11.7.0`, rustc `1.97.1`

## Implemented behavior

The native Lens now derives answer text and request state from correlated durable Harness events. It preserves turn and step identity, accepts only `text-delta` as visible streaming output, uses complete assistant messages to calibrate visible step text, and waits for `turn/end` before entering a terminal request state. Session transport errors do not require a fabricated request id.

Listener registration must complete before session subscription. Late listener registration after unmount releases its callback, and a subscription completion cannot move an already streaming request back to queued. Cursor persistence, subscription generations, durable request deduplication, and submission recovery belong to R02 and R03 and were not accepted by this evidence.

## Automated evidence

| Evidence | Command | Result |
|---|---|---|
| Lens projection and component behavior | `pnpm test:lens:session` | PASS, exit 0, 2 files and 16 tests |
| Native UI regression | `pnpm --dir native test` | PASS, exit 0, 2 files and 16 tests |
| Native TypeScript and production bundle | `pnpm --dir native build` | PASS, exit 0, 24 modules transformed |
| Durable session projection fixture | `pnpm test:session:replay` | PASS, exit 0, 1 file and 2 tests |
| Session service and bridge routing | `pnpm test:session` | PASS, exit 0, 2 files and 9 tests |
| Root TypeScript program | `pnpm typecheck` | PASS, exit 0 |

The tests cover mixed text/reasoning/tool streams, multi-step tool loops, complete-message recovery, cursor duplicates, another request and session, normal completion, cancellation, model errors, output limits, listener delay, and late disposal. The prior implementation would fail these cases because it appended any object with a text field, treated each assistant message as request completion, mapped every end reason to cancellation, and discarded errors without a request id.

## Evidence limits

Evidence level is U for the Lens tests and I for the session replay/service tests. No actual Tauri window, Windows named pipe, browser selection, or real model was exercised in R01. Screenshots and the full interaction recording remain required by R07/R08, after continuous subscription and request lifecycle work are integrated.
