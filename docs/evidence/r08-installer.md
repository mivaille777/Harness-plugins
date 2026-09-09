# R08.4 installer and diagnostic evidence

Date: 2026-09-09

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Implementation status: installer metadata and diagnostic foundation is present; clean Windows installation, upgrade, and uninstall are NOT RUN.

## Delivered foundation

The repository now validates package/Cargo/Tauri version agreement, the Tauri identifier, frontend build wiring, and the icon required for packaging. `test:installer` writes a candidate-bound manifest and a redacted diagnostic record without changing system state. It reports NOT RUN with exit code 2 while `native/src-tauri/tauri.conf.json` keeps `bundle.active=false` or no release installer artifact exists. It does not register startup, modify registry entries, install a browser extension, or remove Harness session data.

Diagnostic output keeps operational phase, pause state, counters, bridge connectivity, error codes, versions, and candidate SHA; selected material, URLs, prompts, answers, file paths, tokens, authorization values, and API keys are replaced recursively.

## Automated results

| Check | Command | Result |
|---|---|---|
| Installer helper tests | `node --test scripts/installer.test.mjs` | PASS, 3 tests |
| Installer probe | `pnpm test:installer` | NOT RUN, exit code 2 because the Tauri bundle is inactive and no installer artifact is built |
| Native development build | `pnpm --dir native build` | PASS; this is a WebView build, not an installer |

## Acceptance boundary

The generated manifest is a diagnostic/review artifact, not an install candidate. A release candidate still needs `pnpm native:build`, version and SHA256 verification, an isolated Windows user or VM, first launch and missing-dependency diagnostics, upgrade/reinstall, clean uninstall, residual-process checks, and proof that Harness durable sessions survive uninstall. Signing, auto-update, startup registration, and public distribution are outside this slice.

The product remains a perception-enhancing reading aid. Interface locale data is UI copy only; translation is not part of installation or product acceptance.
