# P2-2 Capture Latency Metrics

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/capture-latency-metrics`

## Delivered slice

- Capture diagnostics now expose rolling P50/P95 values for UIA event-triggered captures and the fallback provider read path.
- Event latency starts in the UIA event callback and ends after an accepted snapshot has been placed in the publication mailbox. It includes bounded trigger-queue waiting, the configured settle delay, and provider capture work.
- Fallback polling cannot identify the original user selection time. Its percentiles therefore measure only the provider read operation and are labeled separately in the diagnostics page.
- Each path retains at most the most recent 256 latency samples. Percentiles use the nearest-rank method.
- A full UIA trigger queue increments the existing coalesced counter instead of silently dropping the trigger.
- The diagnostics snapshot and page show both latency paths without including selection text or other document content.

## Scope limits

This is one instrumentation slice of P2-2, not completion of the full performance and stability plan. Lens render latency, click-to-interactive latency, memory/cache/window lifecycle metrics, and the 500-selection, rapid-selection, long-run, reconnect/restart, browser-switch, multi-monitor, and DPI stress runs remain unmeasured or unimplemented. No interactive Chrome/Edge latency run was performed for this slice, so the taskbook's P50/P95 budgets are not claimed as met.

## Automated verification

| Check | Result |
|---|---|
| Capture-focused Rust tests | PASS; 9 tests |
| `pnpm test:rust` | PASS; 79 unit tests and 7 integration tests |
| `pnpm --dir native test` | PASS; 100 passed, 1 existing expected failure |
| `pnpm --dir native build` | PASS; TypeScript check and Vite production build |
| `rustfmt --edition 2021 --check native/src-tauri/src/capture.rs` | PASS |
| `git diff --check` | PASS |

These checks validate implementation and presentation, not live Harness latency. The taskbook's P50/P95 budgets are not claimed as met.
