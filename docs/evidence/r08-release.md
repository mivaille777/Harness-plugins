# R08.5 release readiness evidence

Date: 2026-09-09

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Implementation commits: `c264c08ff41f4735553bb55da2015bc808bb7699` introduced the manifest validator; `68eafdf9bc70f2ce87efb1d54ebaf17b9fad8278` added required Windows smoke and artifact integrity checks.

Readiness status: NOT READY. The candidate validator is implemented, but no release manifest can claim readiness while real model, host interaction, browser/window, human-factors, and installer evidence remains unavailable.

## Delivered foundation

`scripts/release.mjs` defines the release manifest schema, required package scripts, required evidence paths, candidate SHA validation, protocol/version checks, PASS/NOT RUN/PENDING consistency rules, support-matrix status and required limitations. It requires both an npm bundle and Windows installer, confines their paths to the repository, and compares their declared byte sizes and SHA-256 values with the actual files. It also compares the manifest's plugin version, Node range and complete `@deepseek-ai/dsh-*` compatibility map with `package.json`. The required command set includes the system-changing `test:installer:smoke`; omitting it or either artifact is a hard failure.

`scripts/check-release.mjs` validates an explicitly supplied manifest or generates a PENDING skeleton for the current candidate. The skeleton discovers existing npm and installer artifacts and records their actual hashes without promoting any result to PASS. The command returns READY with exit code 0 only when every required check, evidence item and support-matrix row is PASS; NOT READY with exit code 2 represents disclosed pending or descriptive evidence; malformed, failed or mismatched files return exit code 1.

The validator checks repository inventory when a local root is supplied, never treats NOT RUN, PENDING, or DESCRIPTIVE_ONLY as PASS, and performs no publish, signing, remote-ref, installer, registry, startup, extension, or Harness-session mutation. Interface locale remains UI-copy configuration only; translation is outside the product scope and is absent from the release manifest actions.

## Automated results

| Check | Command | Result |
|---|---|---|
| Release helper tests | `node --test scripts/release.test.mjs` | PASS, 7 tests, including missing-check/artifact, real hash mismatch and package/Harness version drift cases |
| Candidate check without manifest | `pnpm check:release` | NOT READY, exit code 2; generated a PENDING skeleton and listed all required checks/evidence as non-PASS |
| Candidate artifact discovery | generated skeleton after `pnpm pack` and `pnpm native:build` | PASS for discovering one npm bundle and one NSIS installer with real byte sizes and SHA-256; readiness remains NOT READY until evidence statuses are supplied |

## Acceptance boundary

This evidence proves the deterministic validator and its refusal to overclaim readiness. It does not prove real DeepSeek model execution, H05 host-owned approval/ask-user interactions, browser page/document providers, visible Tauri behavior, Narrator/DPI/multi-monitor behavior, human-factors outcomes, clean Windows installation/upgrade/uninstall, signed artifacts, or public distribution. Those evidence items must be recorded against one later candidate SHA before a release can be marked READY.

The next candidate must include the manifest path, dependency and platform matrix, artifact hashes, focused command results, and links to every required evidence file. A changed implementation or evidence set requires a new candidate SHA and a fresh `check:release` run.
