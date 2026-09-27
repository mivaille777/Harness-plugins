# Floating Lens entry and window

Date: 2026-09-27  
Repository: `mivaille777/Harness-plugins`  
Branch: `feat/floating-lens-ui`  
Implementation commit: `04b4017` (`feat: add passive selection Lens entry`)

## Delivered

- Added a hidden, non-focusable 44×44 passive entry window and kept the full Lens in a separate hidden main window until the entry is clicked.
- The entry confirms the selection identity against the current snapshot, suppresses stale and paused captures, and places itself beside the selection while clamping to the monitor work area.
- Clicking the entry sends only `snapshotId` and `revision` to the main Lens. The main window opens on that exact source identity and receives focus only after the user clicks the entry.
- Esc hides the Lens. If a request is still active, reopening keeps the request's original selection pinned.
- Long selections show a 420-character preview with an explicit expand/collapse control.

## Automated verification

| Command | Result |
|---|---|
| `pnpm --dir native build` | PASS; TypeScript check and production UI build |
| `pnpm --dir native test -- --reporter=dot` | PASS; 90 passed and 1 expected failure across 13 files |
| `cargo check --manifest-path native/src-tauri/Cargo.toml` | PASS; validates the Tauri window and capability configuration |
| `git diff --check` | PASS |

## Runtime checks and limits

- Chrome and Edge selection capture, actual focus behavior, and multi-monitor placement were not manually exercised in this stage.
- The tests cover entry visibility, stale and paused event handling, identity handoff, preview expansion, and work-area clamping. Desktop acceptance remains to be checked with the native app.
