# P0-3 Interaction Guard

Date: 2026-09-27  
Repository: `mivaille777/Harness-plugins`  
Branch: `feat/interaction-guard`
Implementation commit: `757d81e` (`feat: add native interaction guard`)

## Delivered

- Added a native interaction guard with request-keyed, expiring leases, nested modes, idempotent end calls, and a generation counter for invalidating stale capture work.
- Added an RAII lease for `AgentInput` and `LensInteraction`; dropping the lease releases the guard on errors and aborts.
- Connected the guard to UIA events, fallback polling, pending snapshots, and the publisher. Capture triggers and pending snapshots are discarded if their generation became stale or a guard is active.
- User pause now participates in the same capture gate while remaining a distinct UI state.
- The main Lens acquires a `LensInteraction` lease while focused, renews it every 10 seconds, and releases it on blur or teardown. Each lease expires after 30 seconds if the UI stops renewing it.
- `ScreenCapture` begin/end commands hide only the Lens windows that were visible when the first nested request began. The last matching end, or lease expiry, restores those windows. Partial hide failures roll back windows already hidden.
- Native capture shutdown marks the guard as shutting down before stopping its worker threads.
- Added bounded Tauri bridge helpers for `AgentInput`, `ScreenCapture`, `LensInteraction`, and `CapturePaused` callers.

## Automated verification

| Command | Result |
|---|---|
| `cargo check --manifest-path native/src-tauri/Cargo.toml` | PASS |
| `cargo test --manifest-path native/src-tauri/Cargo.toml` | PASS; 59 unit tests plus 7 integration tests |
| `pnpm --dir native build` | PASS; TypeScript check and production UI build |
| `pnpm --dir native test` | PASS; 91 passed, 1 expected failure across 13 files |
| `git diff --check` | PASS |

The guard tests cover begin/end, nested blockers, timeout and generation invalidation, duplicate begin/end, shutdown, user pause, screen-capture window pairing, operation errors, and abort/drop cleanup.

## Runtime checks and limits

- This repository does not currently contain a screenshot operation or an Agent input simulation call site. The new begin/end APIs and Rust RAII helper provide the guard boundary for those callers; actual screenshot and simulated-input integration remains to be connected when those operations are added.
- Screen-capture window handling is verified at the guard-effects level. Actual desktop hide/restore behavior and focus changes were not manually exercised in this run.
- Chrome/Edge capture during a real Lens focus transition was not manually exercised. Automated capture-path checks verify generation and suppression behavior through the native gate.
- The 30-second Lens lease is renewed every 10 seconds; all externally requested leases are capped at 60 seconds and require explicit renewal for longer operations.
