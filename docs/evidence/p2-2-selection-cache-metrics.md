# P2-2 Selection Cache Size Diagnostics

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/selection-cache-size-diagnostics`
Implementation commit: `69646ea0d1239f8d4e6092b4badae5b6d2658327`

## Delivered slice

- Runtime Diagnostics reports the number of live cached selection snapshots held by the Harness plugin's `SelectionContextService`.
- Protocol V4 adds the optional `selection.cache.status` capability and a typed request/result pair. The metric reads the cache's `size` getter, which removes TTL-expired entries before returning the count.
- The Harness advertises the capability during hello. Native sends the request only when the connected Harness advertises support.
- Older Harness versions do not advertise the capability, receive no new request, and appear as “Not provided” with no invented size. Existing `selection.current.result` payloads are unchanged.
- The metric and read errors are included in the copyable diagnostics snapshot; selected text and nearby page content are not added.

## Automated verification

| Check | Result |
|---|---|
| `pnpm test:protocol` | PASS; 16 tests, including shared fixture parity |
| `pnpm test:bridge` | PASS; 12 tests, including capability advertisement and cache count |
| `pnpm test:rust` | PASS; 87 unit tests and 7 integration tests |
| Focused Native UI/API tests (`DiagnosticsPage`, diagnostics snapshot, bridge API, App) | PASS; 44 tests |
| `pnpm --dir native build` | PASS; TypeScript check and Vite production build |
| `rustfmt --edition 2021 --check native/src-tauri/src/bridge.rs native/src-tauri/src/protocol.rs native/src-tauri/src/lib.rs` | PASS |
| `git diff --check` | PASS |

## Known limits

- The value is a point-in-time count of the Harness-side selection snapshot cache; it is not a Native memory measurement.
- No live Harness/Native installation test or cache churn/TTL stress run was performed in this slice.
