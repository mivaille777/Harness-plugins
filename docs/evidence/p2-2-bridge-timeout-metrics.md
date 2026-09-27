# P2-2 Bridge Request Timeout Metric

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/bridge-timeout-diagnostics`
Implementation commit: `32144e93e457b0787e23105380de81b85329798b`

## Delivered slice

- `BridgeStatus` now reports a cumulative `requestTimeoutCount`.
- The counter increments when an active named-pipe request fails at the request/reply transport boundary with a request or write timeout. It survives reconnects for the life of the Native Companion process.
- Runtime Diagnostics displays the count alongside ping latency and reconnect count.
- A deterministic duplex-pipe test withholds the reply and verifies the counter increases once.

## Scope limits

The metric covers requests sent through the connected request/reply pipe. It does not count initial hello/connection timeouts, session-event subscription timeouts, or Harness errors returned as valid responses. It is process-local and resets when Native Companion restarts. No live Harness disconnect/reconnect stress run was performed.

## Automated verification

| Check | Result |
|---|---|
| Focused bridge and diagnostics tests | PASS; 33 tests |
| `pnpm test:rust` | PASS; 80 unit tests and 7 integration tests |
| `pnpm --dir native test` | PASS; 104 passed, 1 existing expected failure |
| `pnpm --dir native build` | PASS; TypeScript check and Vite production build |
| `rustfmt --edition 2021 --check native/src-tauri/src/bridge.rs` | PASS |
| `git diff --check` | PASS |
