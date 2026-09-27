# P2-2 Lens Latency Metrics

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/lens-render-latency`
Implementation commit: `c053fec52e053c400d5e2d757b32c5d16cf17a12`

## Delivered slice

- The native capture publisher attaches an opaque ready timestamp to the identity-only `selection-captured` UI event. It does not include selection content.
- The passive entry reports elapsed time from that ready timestamp through its window show and the next UI event-loop turn.
- Clicking the passive entry includes its request timestamp. The main window records elapsed time after it has shown and focused the Lens.
- Runtime Diagnostics shows rolling P50/P95 and sample counts for both UI measurements.
- Each measurement retains at most 256 recent samples in memory. Samples are process-local and are not persisted.

## Interpretation and limits

These timings are client-side proxies for the taskbook's snapshot-to-entry-visible and click-to-Lens-interactive KPIs. The entry measurement includes the publish notification and UIA/bridge/UI work after the snapshot was queued. Lens interactive ends after the Tauri show and focus calls complete; it does not verify physical monitor presentation or first-frame paint. Both cross-window timestamps use the system wall clock, so a clock adjustment during a measurement can affect that sample.

No live Harness/Chrome/Edge performance run or stress matrix was performed. The displayed rolling distributions become useful only after real user interactions; this implementation alone does not establish the taskbook's P95 budgets.

## Automated verification

| Check | Result |
|---|---|
| Focused App, Diagnostics, PassiveEntry, and rolling-percentile tests | PASS; 41 tests |
| `pnpm --dir native test` | PASS; 104 passed, 1 existing expected failure |
| `pnpm test:rust` | PASS; 79 unit tests and 7 integration tests |
| `pnpm --dir native build` | PASS; TypeScript check and Vite production build |
| `rustfmt --edition 2021 --check native/src-tauri/src/capture.rs` | PASS |
| `git diff --check` | PASS |
