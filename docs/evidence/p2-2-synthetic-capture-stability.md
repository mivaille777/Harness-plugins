# P2-2 Synthetic Capture Stability Coverage

Date: 2026-09-28
Repository: `mivaille777/Harness-plugins`
Branch: `feat/capture-stability-soak`
Implementation commit: `3c627386b6dad9857216131dec3d9aa79d05d91c`

## Delivered slice

The production event-triggered and fallback capture paths now share one queue insertion helper, which applies the same bounded latest-value behavior and updates capture/coalescing/latency counters.

Two deterministic Rust tests exercise that shared path with synthetic snapshots:

- 500 sequential updates are each consumed before the next; the queue stays at depth 1 or less, all 500 are counted as captured, and none are coalesced.
- A 100-update burst is queued before consumption; the queue remains at depth 1, 99 replacements are counted as coalesced, and the final value is `rapid-100`.

The synthetic latency values validate rolling-window and percentile bookkeeping only. They are not measured timings.

## Automated verification

| Check | Result |
|---|---|
| `cargo test --manifest-path native/src-tauri/Cargo.toml synthetic_ -- --nocapture` | PASS; 2 stress-focused tests |
| `pnpm test:rust` | PASS; 92 unit tests and 7 integration tests |
| `rustfmt --edition 2021 --check native/src-tauri/src/capture.rs` | PASS |
| `git diff --check` | PASS |

## Known limits

These are in-process synthetic queue tests. They do not drive the Windows UI Automation provider, Chrome/Edge, the Tauri publisher, a live Harness process, Named Pipe failures, or a two-hour soak. The real desktop stability matrix remains unverified.
