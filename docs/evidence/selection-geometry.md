# P0-5 Selection Geometry

Date: 2026-09-27  
Repository: `mivaille777/Harness-plugins`  
Branch: `feat/selection-geometry`
Implementation commit: `c00bd9d` (`feat: add explicit selection geometry anchors`)

## Delivered

- Added required `precision` and `anchorType` fields to selection geometry in Rust and TypeScript. Allowed precision values are `exact-range`, `pointer-anchor`, `element`, and `window`; the anchor must match the precision.
- Native geometry resolution follows exact range (reserved for a future provider), physical pointer, enclosing UIA element, then browser window. The pointer anchor is represented as a zero-sized point and keeps negative virtual-screen coordinates.
- The Windows provider reads pointer coordinates with `GetPhysicalCursorPos`, which returns physical coordinates. Tauri's Windows event loop configures per-monitor DPI awareness before capture setup.
- Existing placement continues to choose the monitor containing the anchor and clamp the Lens into that monitor's work area. Added coverage for a point anchor at the bottom/right edge of a negative-origin monitor.
- Browser extension geometry now identifies a DOM Range rectangle as `exact-range`/`selection` and an input element rectangle as `element`/`element`.
- Updated the shared IPC fixture and added a negative fixture for mismatched precision/anchor values.

## Automated verification

| Command | Result |
|---|---|
| `cargo test --manifest-path native/src-tauri/Cargo.toml` | PASS; 67 unit tests and 7 integration tests |
| `pnpm exec vitest run tests/protocol.spec.ts tests/selection-context.spec.ts tests/provider-security-contract.spec.ts` | PASS; 35 tests |
| `pnpm --dir native exec vitest run src/lens/position.test.ts src/lens/PassiveEntry.test.tsx` | PASS; 10 tests |
| `pnpm --dir browser-extension check` | PASS; typecheck, 8 tests, and build |
| `pnpm typecheck` | PASS |
| `pnpm --dir native build` | PASS; TypeScript check and production UI build |
| `git diff --check` | PASS |

## Runtime limits

- No live Chrome/Edge interaction was performed at 100%, 125%, or 150% scaling, or with a left/top negative-origin monitor. The native geometry and placement tests are automated coordinate tests, not desktop acceptance evidence.
- `uiautomation 0.16.1` still does not expose exact TextRange bounding rectangles. A keyboard selection may therefore use the current pointer as its first available anchor; this requires live usability verification.
- Browser extension screen coordinates still use its existing `screenX` plus DOM rectangle calculation. This change labels the rectangle source but does not establish its conversion to physical pixels across mixed-DPI monitors; do not treat the extension path as DPI-verified for native window placement.

References: [Microsoft UI Automation screen scaling guidance](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-screenscaling), [GetPhysicalCursorPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getphysicalcursorpos), and [CSSOM View coordinate units](https://drafts.csswg.org/cssom-view/).
