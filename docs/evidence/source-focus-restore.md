# P0-4 Source Identity and Focus Restore

Date: 2026-09-27  
Repository: `mivaille777/Harness-plugins`  
Branch: `feat/source-focus-restore`  
Implementation commit: `249582f` (`feat: add guarded source focus restore`)

## Delivered

- Browser UIA snapshots can carry an optional `SourceWindowIdentity`: process ID, hex-encoded HWND, process name, window title, capture time, and focus epoch.
- Rust and TypeScript validate this identity at their protocol boundaries. The native focus registry binds it to the exact `snapshotId + revision` and retains at most 64 identities.
- A native foreground tracker ignores this app's own Lens windows and advances the epoch when the external foreground task changes. Capture rejects an identity when its HWND/PID is no longer the external foreground source.
- The Lens requests focus restoration when a request reaches a terminal state or when the user closes the Lens. The command accepts only `snapshotId + revision`; the renderer cannot provide a PID or HWND.
- Before restoring, Native checks the identity's five-minute age limit, focus epoch, current external window, HWND validity and visibility, minimized state, owner PID, executable name when available, and normalized window title. It then requests `SetForegroundWindow` and respects Windows foreground denial.
- Source identity is not included in `SelectionMaterial`, so PID/HWND data is not forwarded to the model.

## Automated verification

| Command | Result |
|---|---|
| `cargo check --manifest-path native/src-tauri/Cargo.toml` | PASS |
| `cargo test --manifest-path native/src-tauri/Cargo.toml` | PASS; 64 unit tests plus 7 integration tests |
| `pnpm test` | PASS; 111 tests across 18 files |
| `pnpm --dir native build` | PASS; TypeScript check and production UI build |
| `pnpm --dir native test` | PASS; 92 passed, 1 expected failure across 13 files |
| `git diff --check` | PASS |

Focus tests cover external task changes, ignored Lens focus, exact window/process/epoch matching, identity expiry, bounded identity retention, and exclusion from model material. UI tests cover focus restore after request completion and Lens close; protocol tests validate identity transport and reject a zero HWND.

## Runtime checks and limits

- Chrome/Edge foreground restoration, minimized-window refusal, and title/process checks were not manually exercised in a live desktop session.
- Foreground changes are sampled every 50 ms. A very brief switch entirely between samples could go unobserved; Windows `SetForegroundWindow` remains the final OS-level permission check.
- The Rust test linker emitted a non-fatal `LNK4209` debug-symbol warning for a build object; linking completed and all Rust tests passed.
