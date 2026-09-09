# R08.2 narrow-window overflow hardening

Date: 2026-09-09

The Lens uses a compact 390 px Tauri window. Flex and grid children with intrinsic labels can otherwise keep a wider minimum size than the window, which clips the session selector, status notices, or the next action. The fix is limited to presentation CSS and does not change selection, session, protocol, or model behavior.

The Lens and its direct panels now declare a zero minimum inline size, the session selector is constrained to its parent width, status notices wrap arbitrary untrusted text, and the session caption switches to wrapping below 420 px. Horizontal overflow is clipped at the Lens scroll surface only after these content-level wrapping and shrink rules are applied; vertical scrolling remains available.

The visual contract checks the responsive rules, long-notice wrapping, narrow-caption rule, and exact 390×430 / 900×1700 PNG dimensions. The existing PNGs remain deterministic visual fixtures; a future R07 L3 driver must recapture the same states from the candidate's actual native window and record focus, DPI, and monitor evidence.

Verification:

```powershell
pnpm test:ui:visual
pnpm test:ui:a11y
pnpm --dir native test
git diff --check
```

This change intentionally adds no translation action or translation prompt. Locale continues to own interface copy only.
