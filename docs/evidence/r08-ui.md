# R08 perception-first UI evidence

Date: 2026-09-09

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Implementation commit: `400feafa53acd6b984512ebf56b9f807bc4f1118`.

Environment: Windows, Tauri development binary using WebView2, Node `v24.11.1`, pnpm `11.7.0`, Rust `1.97.1`, system locale `zh-CN`, dark color scheme. The page was rendered by the real Tauri WebView2 target with a temporary local bridge and a non-sensitive deterministic session fixture. The bridge did not call a DeepSeek model. CDP viewport capture was used only to make the two review sizes reproducible; it does not prove native focus, monitor geometry, DPI conversion, browser UI Automation, or human-factors outcomes.

## Product behavior observed

The real Tauri window displays a fixed source selection, source and revision, durable Harness history, one primary `解释` action, a captured-context disclosure, explicit context-scope loading, the contextual question composer, a completed `Harness 回答`, copy-answer feedback, and the separate capture pause action. The fixed selection remains the only material submitted by the Lens request; context expansion is a bounded reference preview. No translation action or translation prompt is present.

## Screenshots

- [Tauri narrow view, 390×430](r08-ui-tauri-zh-dark-narrow.png) — responsive session controls and history remain within the viewport.
- [Tauri completed view, 900×1700](r08-ui-tauri-zh-dark-wide.png) — fixed material, captured-context controls, one Explain action, question composer, and completed answer are visible together.

## Automated results

| Check | Command | Result |
|---|---|---|
| Type safety | `pnpm typecheck` | PASS |
| Context expansion behavior | `pnpm test:context-expansion` | PASS, 15 tests |
| Bridge routing | `pnpm test:bridge` | PASS, 10 tests |
| Protocol and fixture parsing | `pnpm test:protocol` | PASS, 14 tests |
| Browser extension unit tests | `pnpm --dir browser-extension test` | PASS, 3 files and 7 tests |
| Native UI suite | `pnpm --dir native test` | PASS, 4 files and 39 tests |
| Native production build | `pnpm --dir native build` | PASS |
| Rust protocol tests | `cargo test --manifest-path native/src-tauri/Cargo.toml protocol::tests` | PASS, 7 tests |
| Rust full suite | `cargo test --manifest-path native/src-tauri/Cargo.toml` | PASS, 25 tests |
| Named Pipe integration | `pnpm test:bridge:integration` | PASS, Node/Rust probe including selection.expand |
| UI accessibility | `pnpm test:ui:a11y` | PASS, focused Lens control test |
| Visual contract and screenshots | `pnpm test:ui:visual` | PASS, both PNGs and theme/accessibility rules |
| Task aggregate | `pnpm check:task5` | PASS |
| Keyless session runner | `pnpm test:session:e2e` | PASS runner; L1 PASS, L2 NOT RUN without `DEEPSEEK_API_KEY` |
| Real Lens runner | `pnpm test:lens:e2e` | L3 NOT RUN, exit code 2 because the real driver/window precondition is absent |

## Limits and next work

The screenshots are real Tauri WebView2 output, but use a deterministic local bridge and therefore do not establish a real model response, host approval, browser selection, native focus restoration, DPI/multi-monitor placement, or human-factors outcomes. The page/section provider still supplies only context captured with the immutable snapshot; this slice does not fetch document text, persist expanded previews, or add context to model input automatically. H05 host-owned interactions, real DeepSeek model execution, real browser document-change validation, L3 focus/DPI/multi-monitor checks, installer validation, and release-candidate checks remain separate acceptance items.

The product scope is perception-enhancing reading support. Interface locale selection is retained for UI copy only; translation is intentionally out of scope.
