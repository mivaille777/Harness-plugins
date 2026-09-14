# R08.4 installer and diagnostic evidence

Date: 2026-09-09

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Implementation commits: `daa0c3bef12416abadd1f3d7ba104b6ab44a0b21` enables the installer and adds the isolated smoke; `68eafdf9bc70f2ce87efb1d54ebaf17b9fad8278` adds release artifact validation and the multi-resolution product icon.

## Delivered foundation

The repository validates package/Cargo/Tauri version agreement, the Tauri identifier, frontend build wiring, an active NSIS-only bundle, current-user install mode, and the multi-resolution icon required for packaging. `test:installer` writes a candidate-bound manifest and a redacted diagnostic record without changing system state. `test:installer:smoke` installs the generated NSIS candidate into a unique temporary directory, launches the installed executable, performs a same-version reinstall, runs the installed uninstaller, waits for NSIS asynchronous cleanup, and rejects executable residue. Its cleanup assertion is restricted to the temporary directory it creates.

Diagnostic output keeps operational phase, pause state, counters, bridge connectivity, error codes, versions, and candidate SHA; selected material, URLs, prompts, answers, file paths, tokens, authorization values, and API keys are replaced recursively.

## Automated results

| Check | Command | Result |
|---|---|---|
| Installer helper tests | `node --test scripts/installer.test.mjs` | PASS, 4 tests |
| Native installer build | `pnpm native:build` | PASS; generated one current-user x64 NSIS installer |
| Installer probe | `pnpm test:installer` | PASS; candidate `68eafdf9`, SHA-256 `ab0b34a747ba178fd70da9fdd6837d0054d38bc85ae52f56c953d3cbefd2d496` |
| Isolated Windows smoke | `R08_CANDIDATE_SHA=68eafdf... pnpm test:installer:smoke` | PASS: install, installed-file check, launch, reinstall, uninstaller, and executable-residue check |
| Post-smoke residue review | process, HKCU uninstall entry, and Start Menu checks | PASS; zero matching process, uninstall entry, or shortcut |

## Acceptance boundary

This run proves an unsigned current-user NSIS candidate on the development Windows account. It does not prove a second clean Windows account or VM, migration from an older released version, missing-WebView recovery, signing, auto-update, public distribution, or the installed application's complete browser-selection-to-Harness path. The smoke never removes Harness configuration or durable session data; a later full-product uninstall review must additionally observe that an existing Harness session survives.

The product remains a perception-enhancing reading aid. Interface locale data is UI copy only; translation is not part of installation or product acceptance.
