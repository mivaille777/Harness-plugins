# P2-2 Lens Selection Notification Stress Coverage

Date: 2026-09-28  
Repository: `mivaille777/Harness-plugins`  
Branch: `test/lens-selection-switch-stress`  
Implementation commit: `d84f8ac`

## Delivered slice

Added a deterministic Native UI regression test that sends 100 ordered `selection-captured` notifications while the Lens is showing a pinned selection. The test confirms that the displayed selection stays pinned, then switches to the latest Edge snapshot only after the user explicitly chooses **Use latest selection**.

The notifications carry snapshot identity and revision only. This exercises Lens event handling and binding isolation; it does not simulate individual browser processes or UI Automation captures.

## Automated verification

| Check | Result |
|---|---|
| `pnpm --dir native exec vitest run src/App.test.tsx -t "100 selection notifications"` | PASS; 1 targeted test, 26 skipped |
| `pnpm --dir native exec vitest run src/App.test.tsx` | PASS; 27 tests |
| `git diff --check` | PASS |

## Known limits

This is an in-process UI event test. It does not perform 100 real Chrome/Edge switches, exercise UI Automation, use a real Tauri window or Harness process, or measure a two-hour run. The taskbook's real browser-switch matrix remains NOT RUN until a real desktop driver is configured and executed.
