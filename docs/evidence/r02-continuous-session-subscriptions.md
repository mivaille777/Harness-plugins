# R02 continuous session subscription evidence

Date: 2026-09-07

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Verification commit: this document's commit

Environment: Windows, Node.js `v24.11.1`, pnpm `11.7.0`, rustc `1.97.1`

## Automated evidence

| Evidence | Command | Result |
|---|---|---|
| Session service and router | `pnpm test:session` | PASS, exit 0, 2 files and 15 tests |
| TCP framing and lifecycle faults | `pnpm test:session:transport` | PASS, exit 0, 1 file and 6 tests |
| Durable replay projection | `pnpm test:session:replay` | PASS, exit 0, 1 file and 2 tests |
| Cross-language protocol fixture | `pnpm test:protocol` | PASS, exit 0, 1 file and 11 tests |
| Lens generation and cursor projection | `pnpm test:lens:session` | PASS, exit 0, 2 files and 18 tests |
| Native frontend build | `pnpm --dir native build` | PASS, exit 0, 24 modules transformed |
| Rust unit and shared fixture suite | `pnpm test:rust` | PASS, exit 0, 22 tests |
| Real Windows Node/Rust named pipe | `pnpm test:bridge:integration` | PASS, exit 0, 100 ordered events with concurrent ping/submit; clients/listeners returned to zero |

The deterministic race cases cover an event arriving while history is awaited, a duplicate present in snapshot and live buffer, read failure cleanup, cursor beyond high-water, a missing sequence, socket close before subscribe returns, long model silence beyond the request timeout, pending-write overflow, fragmented input, and two independent subscriptions.

## Evidence limits

The named-pipe result is W-level transport evidence with a deterministic fake session source. It does not use a DeepSeek model, real persisted session directory, browser selection, or visible Tauri window. Durable request deduplication, submission-unknown recovery, multi-input turn ownership, and cancellation races remain R03.
