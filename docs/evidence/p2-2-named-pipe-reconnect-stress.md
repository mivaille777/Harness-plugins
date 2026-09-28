# P2-2 Named Pipe Reconnect Stress Coverage

Date: 2026-09-28
Repository: `mivaille777/Harness-plugins`
Branch: `feat/bridge-reconnect-stability-soak`
Implementation commit: `1124bb48e449a574160a3fbab306292cf8cf1329`

## Delivered slice

Expanded the Windows `BridgeRuntime` named-pipe test to simulate 20 server-side pipe closures. After each closure, the next selection request must open a fresh pipe, repeat `bridge.hello`, and successfully submit the selection. The test then confirms `selection.current` still works, the reconnect counter is 20, and no request timed out.

## Automated verification

| Check | Result |
|---|---|
| `cargo test --manifest-path native/src-tauri/Cargo.toml selection_update_recovers_from_twenty_named_pipe_disconnects -- --nocapture` | PASS on Windows; 20 disconnect/reconnect cycles |
| `pnpm test:rust` | PASS; 92 unit tests and 7 integration tests |
| `rustfmt --edition 2021 --check native/src-tauri/src/bridge.rs` | PASS |
| `git diff --check` | PASS |

## Known limits

The test uses real Windows Named Pipes and the Native `BridgeRuntime`, but an in-process Harness-protocol server fixture. It does not restart the full Tauri application or use an installed Harness process. Native restart, browser switching, UI Automation, DPI/multi-monitor placement, and the two-hour soak remain unverified.
