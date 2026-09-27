# P1-5 Runtime Diagnostics

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/runtime-diagnostics`

## Delivered

- Added a Diagnostics page reachable from the Lens footer, with separate Harness, Bridge, Capture, Selection, Lens, and Session sections. The main Lens no longer displays detailed capture errors.
- Refresh performs a live bridge ping, probes `selection.current` and lists sessions when connected, reads capture and interaction-guard state, and refreshes every 10 seconds while the page is open.
- Joined health state reports a connected bridge as unhealthy when the live ping or `selection.current` probe fails. A disconnected bridge remains distinct from an unavailable status command.
- Exposed the bridge reconnect counter and a read-only Interaction Guard status command. Session diagnostics track the loaded durable cursor and advance it as persistent events arrive.
- Copy exports runtime identifiers, versions, status, timestamps, and counters. It excludes selected text, nearby/page context, document title, URL, and conversation history by construction.
- Harness version and Profile are displayed as unavailable because the current host API does not report them. Plugin loaded/version are only reported from a successful bridge handshake; Session Adapter status reflects the live session-list probe.

## Automated verification

| Command | Result |
|---|---|
| `pnpm --dir native test` | PASS; 15 files, 99 passed; 1 existing expected failure in `ec01-expanded-context.test.tsx` |
| `pnpm --dir native build` | PASS; TypeScript check and Vite production build |
| `pnpm test:rust` | PASS; 76 unit tests and 7 integration tests |
| `rustfmt --edition 2021 --check native/src-tauri/src/bridge.rs native/src-tauri/src/interaction_guard.rs native/src-tauri/src/lib.rs` | PASS |

Coverage verifies the combined connected-bridge/failed-selection health invariant, failed ping health, disconnected state, snapshot privacy, all six page sections, back navigation, and clipboard export.

## Limits

- Harness version and Profile cannot be populated until the host exposes those values through a supported API.
- UI behavior was verified with the native UI test environment; no live Harness process or packaged desktop installer was exercised in this phase.
- Workspace-wide `cargo fmt --check` still reports pre-existing formatting differences in the untouched `pipeline_probe.rs` and `uia_probe.rs` files.
