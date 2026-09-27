# P2-2 Window Lifecycle Metrics

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/window-lifecycle-diagnostics`
Implementation commit: `7c0f6e050a7516b0b3820b6e21572a3d2071d014`

## Delivered slice

- Runtime Diagnostics reports cumulative window-created, window-destroyed, and active-window counts for the Native Companion process.
- The startup count is initialized from Tauri's managed webview windows. The current configuration creates the `main` and `entry` windows, so the initial created and active counts are both 2.
- An app-wide `WindowEvent::Destroyed` listener increments the destroyed count and decrements active count. Showing or hiding a window does not change lifecycle counters.
- The counters are available through a typed, read-only Tauri command and included in the copyable diagnostics snapshot.

## Interpretation and limits

Counts are process-local and reset when Native Companion restarts. The current app has only the two statically configured windows and no dynamic window builders. If future code creates windows dynamically, it must call `record_created()` at each creation site; destruction events are already observed globally. No live window churn or restart stress run was performed.

## Automated verification

| Check | Result |
|---|---|
| Native UI full suite | PASS; 106 passed, 1 existing expected failure |
| `pnpm test:rust` | PASS; 85 unit tests and 7 integration tests |
| `pnpm --dir native build` | PASS; TypeScript check and Vite production build |
| `rustfmt --edition 2021 --check native/src-tauri/src/window_lifecycle.rs` | PASS |
| `git diff --check` | PASS |

