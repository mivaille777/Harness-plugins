# R07 layered runner evidence

Date: 2026-09-08

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Candidate code SHA tested: `eac4d23` (the runner implementation is in `3168b23`; `eac4d23` additionally serializes Rust bridge environment-variable tests). The evidence document and screenshots are committed afterward; rerun the commands below when selecting a later release candidate.

Environment: Windows (`win32`), Node `v24.11.1`, pnpm `11.7.0`, Rust `1.97.1`, installed `dsh` `0.1.1-rc.2`. The process did not contain `DEEPSEEK_API_KEY`, so real-model execution was not authorized or available. The local L1 provider was a loopback deterministic SSE endpoint and used an isolated `DSH_HOME`.

## Automated results

| Layer or check | Exact command | Observed result |
|---|---|---|
| Runner unit tests | `pnpm test:r07:runner` | PASS, 3 tests, exit 0 |
| Lens-driver coordinator tests | `pnpm test:lens:runner` | PASS, 5 tests, exit 0 |
| L1 profile smoke | `pnpm test:session:e2e` | L1 PASS, L2 NOT RUN, process exit 0; report: `%TEMP%\dsh-selection-companion-r07-reports\r07-session-e2e.json` |
| L3 native-driver coordinator | `pnpm test:lens:e2e` | L3 NOT RUN, process exit 2; report: `%TEMP%\dsh-selection-companion-r07-reports\r07-lens-e2e.json` because `R07_LENS_DRIVER` was not configured |
| TypeScript source | `pnpm typecheck` | PASS, exit 0 |
| Full plugin unit suite | `pnpm test` | PASS, 9 files and 69 tests |
| Candidate aggregate | `pnpm check:task5` | PASS: typecheck, 69 plugin tests, root build/bundle, Native build, Rust 25 tests, Native UI 33 tests, Cargo check and browser-accessibility 5 tests |
| Shared protocol and Rust contract | `pnpm test:contract` | PASS: protocol 13 tests, Native build, Rust 25 tests |
| Windows Node/Rust pipe | `pnpm test:bridge:integration` | PASS: 100 ordered events plus ping/list/create/history/submit and zero remaining clients/listeners |
| Rust formatting | `cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check` | PASS, exit 0 |

The L1 report observed `dsh` profile installation, `dsh-selection-companion` in the headless profile bundle list, the plugin startup line, the fixed `R07_SESSION_OK` response from the loopback endpoint, two local model requests, and one non-empty durable `session.jsonl.zstd` file. No credential or selection body was written to the report.

## Native visual fixture observation

The Tauri development binary was launched with `pnpm native:dev`. A temporary local bridge supplied a non-sensitive fixed snapshot and deterministic history so the actual Tauri WebView could be inspected. The window was resized to 620×900 for readability; the fixture text is not a real browser selection and the bridge did not run a DeepSeek model. The screenshots therefore demonstrate the current Lens material/history/answer presentation only; they are W/U visual-fixture evidence and do not satisfy R07 L3.

- [Idle Tauri fixture window](r07-tauri-fixture-idle.png) — no current selection state.
- [Material and completed fixture answer](r07-tauri-fixture-complete.png) — durable history, fixed material, and answer rendered in the real Tauri window.

The current 390×430 production window also showed horizontal clipping of the session controls and long notice text in the captured idle state. This is a concrete R08.2 visual follow-up, not a reason to weaken the L3 evidence gate.

## Unverified items

L2 remains NOT RUN without a real model credential. R05 host-owned approval/ask-user capability is still pending H05. L3 remains NOT RUN because no `R07_LENS_DRIVER` executed real Chrome/Edge UI Automation and Tauri focus/geometry assertions. Browser selection, tool/approval decisions, stop/reconnect, complete Harness navigation, process restart, DPI/multi-monitor behavior and human-factors outcomes are not established by this evidence.
