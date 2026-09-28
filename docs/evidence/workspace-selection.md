# Windows workspace selection for Lens sessions

Date: 2026-09-28  
Repository: `mivaille777/Harness-plugins`  
Branch: `feat/workspace-selection`  
Implementation commit: `dbf6bd6`

## Behavior

The Lens now offers **Choose workspace for new session**. A native Windows folder picker returns a local directory to Rust; Rust verifies that the selected path is an accessible absolute directory and sends it through the existing `session.create.cwd` protocol field. Harness creates the Agent session with that directory in `meta.cwd`. Cancelling the picker does not create or switch sessions. The WebView command accepts no caller-supplied path.

The chosen path is shown for that session during the current Lens process. New sessions made without the picker continue to use Harness's configured working directory. Existing sessions keep their original working directories.

The dependency change adds `rfd 0.16.0` and its Windows dependency to Cargo.lock while retaining the repository's existing Tauri `2.11.5` line.

## Verification

| Check | Result |
|---|---|
| `pnpm --dir native build` | PASS; TypeScript and Vite production build |
| `pnpm --dir native exec vitest run src/App.test.tsx src/api/bridge.test.ts` | PASS; 41 tests, including selected workspace, cancelled picker, pending picker controls and chosen session submission |
| `pnpm exec vitest run tests/session-service.spec.ts` | PASS; 16 tests; selected `cwd` asserted in Agent creation metadata |
| `pnpm test:bridge:integration` | PASS on Windows; Node/Rust Named Pipe test asserts `session.create.cwd` arrives unchanged and all pipe clients/listeners close |
| `cargo check --locked --manifest-path native/src-tauri/Cargo.toml` | PASS |
| `pnpm typecheck` | PASS |
| `rustfmt --edition 2021 --check native/src-tauri/src/bridge.rs` | PASS |
| `rustfmt --edition 2021 --check --config skip_children=true native/src-tauri/src/lib.rs` | PASS |
| `git diff --check` | PASS |

The repository-wide `cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check` still reports pre-existing formatting differences in the untouched `pipeline_probe.rs` and `uia_probe.rs` binaries. The modified Rust files passed their focused formatting checks.

## Remaining acceptance

The Windows folder picker has not been exercised in a visible Tauri window. A supported DeepSeek Harness profile with a real browser selection, model response and restored durable history has not been run for this commit. The Session list API does not currently expose stored working directories, so a folder selected in an earlier Lens process is not redisplayed after restart; the Harness session retains its `cwd`.
