# P2-2 Bridge Latency Percentiles

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/bridge-latency-diagnostics`
Implementation commit: `8443d969da096fe34c2c3a8592384c4aa82b5c84`

## Delivered slice

- Keeps the latest successful Bridge Ping round-trip latency and a rolling window of the latest 256 successful samples.
- Runtime Diagnostics reports the most recent Ping latency, nearest-rank P50/P95, and sample count.
- Failed or malformed Ping responses do not enter the latency distribution. Existing reconnect and timeout counters remain unchanged.
- Latency statistics are process-local and reset when Native Companion restarts.

## Automated verification

| Check | Result |
|---|---|
| `pnpm test:rust` | PASS; 90 unit tests and 7 integration tests |
| `pnpm --dir native test` | PASS; 108 passed, 1 existing expected failure |
| `pnpm --dir native build` | PASS; TypeScript check and Vite production build |
| `pnpm test:bridge:integration` | PASS on Windows; 100 ordered events plus selection expansion, ping, session list/create/history, and submit over real Node/Rust Named Pipes; clients and listeners returned to zero |
| `rustfmt --edition 2021 --check native/src-tauri/src/bridge.rs` | PASS |
| `git diff --check` | PASS |

## Known limits

- Samples measure successful `bridge.ping`/`bridge.pong` round trips, not every Named Pipe request type.
- The pipe integration uses the repository's Node bridge fixture, not a running Harness installation. No production Harness latency/load measurement or long-duration desktop stability run was performed in this slice.
