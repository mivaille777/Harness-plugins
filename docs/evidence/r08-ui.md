# R08 perception-first UI evidence

Date: 2026-09-08

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Candidate code SHA: record the commit that contains the R08 UI change; the evidence commit may update this field after the code commit is created.

Environment: Windows, Tauri development binary using WebView2, Node `v24.11.1`, pnpm `11.7.0`, system locale `zh-CN`, dark color scheme. The page was rendered by the real Tauri WebView2 target with a temporary local bridge and a non-sensitive deterministic session fixture. The bridge did not call a DeepSeek model. CDP viewport capture was used only to make the two review sizes reproducible; it does not prove native focus, monitor geometry, DPI conversion or browser UI Automation.

## Product behavior observed

The real Tauri window displays a fixed source selection, its source and revision, durable Harness history, one primary `解释` action, the contextual question composer, a completed `Harness 回答`, copy-answer feedback affordance and the separate capture pause action. No translation action or translation prompt is present.

## Screenshots

- [Tauri narrow view, 390×430](r08-ui-tauri-zh-dark-narrow.png) — responsive session controls and history remain within the viewport.
- [Tauri completed view, 900×1700](r08-ui-tauri-zh-dark-wide.png) — fixed material, one Explain action, question composer and completed answer are visible together.

## Automated results

| Check | Command | Result |
|---|---|---|
| Accessibility control labels | `pnpm test:ui:a11y` | PASS, 1 focused test; Explain, Ask, session, close and live status are discoverable |
| Native UI suite | `pnpm --dir native test` | PASS, 4 files and 36 tests |
| Native production build | `pnpm --dir native build` | PASS |
| Visual contract | `pnpm test:ui:visual` | PASS; required theme, reduced-motion, forced-colors and responsive rules plus both PNGs are valid |

## Limits and next work

The screenshots are real Tauri WebView2 output, but use a deterministic local bridge and therefore do not establish a real model response, host approval, browser selection, native focus restoration, DPI/multi-monitor placement or human-factors outcomes. R07 L2/L3 and R08.1/R08.3/R08.4/R08.5 remain separate acceptance items.
