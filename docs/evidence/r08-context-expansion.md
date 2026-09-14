# R08.1 selection context expansion evidence

Date: 2026-09-09

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Implementation commit: `400feafa53acd6b984512ebf56b9f807bc4f1118`.

Environment: Windows, Node `v24.11.1`, pnpm `11.7.0`, Rust `1.97.1`, Tauri WebView2 development binary, and the temporary deterministic bridge used by the UI evidence capture.

## Purpose and scope

R08.1 exposes context that a provider already captured with one immutable selection snapshot. The user opens the captured-context disclosure, chooses `local`, `section`, or `page` when the snapshot advertises that capability, and presses `Load context`. The response carries the snapshot revision, completeness, and truncation metadata. The Lens keeps the fixed selection as the request material; expanded context remains a bounded reference preview and is not silently sent to Harness.

The TypeScript service applies positive safe-integer limits of 6,000 Unicode code points per field and 24,000 aggregate UTF-8 bytes by default. It removes NUL characters, does not split surrogate pairs or emoji, distinguishes missing snapshots from unavailable capabilities and missing captured text, and never fetches a page during expansion. The Rust protocol, named-pipe probe, Tauri command, browser snapshot type, and Lens API use the same optional fields and revision check.

## Focused evidence

| Surface | Command | Result |
|---|---|---|
| Expansion service and bounds | `pnpm test:context-expansion` | PASS, 15 tests |
| TypeScript protocol | `pnpm test:protocol` | PASS, 14 tests |
| Bridge server | `pnpm test:bridge` | PASS, 10 tests |
| Browser page capability | `pnpm --dir browser-extension test` | PASS, 3 files and 7 tests |
| Optional DOM selection path | `pnpm check:browser-extension:e2e` | PASS, including a real Chromium `mouseup` selection capture |
| Native bridge API | `pnpm --dir native test src/api/bridge.test.ts` | PASS, 6 tests |
| Native UI behavior | `pnpm --dir native test` | PASS, 4 files and 39 tests |
| Native build | `pnpm --dir native build` | PASS |
| Rust protocol | `cargo test --manifest-path native/src-tauri/Cargo.toml protocol::tests` | PASS, 7 tests |
| Rust full suite | `cargo test --manifest-path native/src-tauri/Cargo.toml` | PASS, 25 tests |
| Rust formatting | `cargo fmt --manifest-path native/src-tauri/Cargo.toml --check` | PASS |
| Node/Rust Named Pipe | `pnpm test:bridge:integration` | PASS, selection.update and selection.expand probe |
| Aggregate contract | `pnpm test:contract` | PASS |
| Aggregate task check | `pnpm check:task5` | PASS |
| UI accessibility | `pnpm test:ui:a11y` | PASS |
| UI visual contract | `pnpm test:ui:visual` | PASS; narrow 390×430 and wide 900×1700 screenshots |

## Manual review artifact

The [narrow Tauri capture](r08-ui-tauri-zh-dark-narrow.png) is 390×430 pixels and exercises responsive history/session controls. The [wide Tauri capture](r08-ui-tauri-zh-dark-wide.png) is 900×1700 pixels and shows the Chinese dark Lens with the captured-context disclosure open, scope selector, explicit `加载上下文` action, complete status, before/after context, fixed material, Explain, composer, and completed answer.

## Not run and acceptance boundary

`pnpm test:session:e2e` reports L1 PASS and L2 NOT RUN without `DEEPSEEK_API_KEY`; `pnpm test:lens:e2e` reports L3 NOT RUN with exit code 2 when no real Tauri/browser driver is configured. The current slice does not validate a real browser page provider, document mutation between capture and expansion, durable storage of preview text, H05 host interaction/approval, installer behavior, or human-factors measurements. Translation is not a feature of this product and has no implementation or acceptance item.
