# R08.5 release readiness evidence

Date: 2026-09-09

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Implementation commit: `c264c08ff41f4735553bb55da2015bc808bb7699`

Readiness status: NOT READY. The candidate validator is implemented, but no release manifest can claim readiness while real model, host interaction, browser/window, human-factors, and installer evidence remains unavailable.

## Delivered foundation

`scripts/release.mjs` defines the release manifest schema, required package scripts, required evidence paths, candidate SHA validation, protocol/version checks, and PASS/NOT RUN/PENDING consistency rules. `scripts/check-release.mjs` validates an explicitly supplied manifest or generates a PENDING skeleton for the current candidate; it returns READY with exit code 0 only when every required check and evidence item is PASS, NOT READY with exit code 2 when evidence is missing or pending, and FAIL with exit code 1 for malformed or failed input.

The validator checks repository inventory when a local root is supplied, never treats NOT RUN, PENDING, or DESCRIPTIVE_ONLY as PASS, and performs no publish, signing, remote-ref, installer, registry, startup, extension, or Harness-session mutation. Interface locale remains UI-copy configuration only; translation is outside the product scope and is absent from the release manifest actions.

## Automated results

| Check | Command | Result |
|---|---|---|
| Release helper tests | `node --test scripts/release.test.mjs` | PASS, 4 tests |
| Candidate check without manifest | `pnpm check:release` | NOT READY, exit code 2; generated a PENDING skeleton and listed all required checks/evidence as non-PASS |
| Candidate check direct probe | `node scripts/check-release.mjs` | NOT READY, exit code 2; candidate SHA was read from the local HEAD |

## Acceptance boundary

This evidence proves the deterministic validator and its refusal to overclaim readiness. It does not prove real DeepSeek model execution, H05 host-owned approval/ask-user interactions, browser page/document providers, visible Tauri behavior, Narrator/DPI/multi-monitor behavior, human-factors outcomes, clean Windows installation/upgrade/uninstall, signed artifacts, or public distribution. Those evidence items must be recorded against one later candidate SHA before a release can be marked READY.

The next candidate must include the manifest path, dependency and platform matrix, artifact hashes, focused command results, and links to every required evidence file. A changed implementation or evidence set requires a new candidate SHA and a fresh `check:release` run.
