# UPA-00 provider security baseline evidence

Date: 2026-09-14

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Baseline before UPA-00: `76530ceeeaf52f26c56c19fecde7496c3acf40ea`

UPA-00 implementation commits:

- `ed4e9b9d895bf1efc923e6091f67208a3103e47a` — keep local file paths out of Session material
- `a14850de5b4162ce4ceeb24f54591be7ed8f5ba5` — freeze provider material safety contract in tests

## Security contract frozen by this batch

UPA-00 deliberately leaves `SelectionSnapshot` rich enough for Native/Lens provider behavior while constraining the material that may cross the durable Harness Session / Agent boundary.

The frozen contract is:

1. `SelectionMaterial` contains only the fixed snapshot identity, revision, capture time, selected text/language, source identity, model-safe document identity, and literal `selection` authorization/actual scope.
2. Provider-only `context`, `capabilities`, `geometry`, provider id, and confidence are not projected into material.
3. `document.filePath` may exist on a provider `SelectionSnapshot` for local Native/Lens use, but `selectionMaterialFromSnapshot()` does not project it.
4. Incoming legacy/Rust-wire material containing `document.filePath` is sanitized before strict material validation and before Agent tools can expose it.
5. A tool call resolves only durable selection material visible before that call in its turn. A later selection event cannot replace material already visible to an earlier tool call.

## New regression coverage

`tests/provider-security-contract.spec.ts` adds deterministic tests for:

- rich provider snapshot → selection-only material projection;
- local `filePath` stripping from both fresh projection and legacy/wire material;
- exclusion of surrounding context/capabilities/geometry/provider diagnostics from material;
- durable request binding when a newer selection arrives after the tool call.

These tests complement the existing `tests/session-tools.spec.ts` Agent/session isolation, policy, disposal, cancellation, and durable-turn coverage.

## Intended verification commands

```powershell
pnpm exec vitest run tests/provider-security-contract.spec.ts
pnpm test:session:tools
pnpm test:session:replay
pnpm test:protocol
pnpm typecheck
```

## Execution evidence for this commit

Automated execution is **NOT RUN in the connector execution environment**. A local clone attempt failed before dependency/test execution because the container cannot resolve `github.com`:

```text
fatal: unable to access 'https://github.com/mivaille777/Harness-plugins.git/': Could not resolve host: github.com
```

This document therefore does **not** claim PASS for the commands above. Historical R04 evidence is not reused as evidence for UPA-00.

The branch contents and commit ancestry were verified through the connected GitHub repository after both implementation commits were pushed.

## Remaining UPA-00 gate

UPA-00 becomes execution-verified only after the intended commands above run from a checkout of this branch and all exit with code 0. Any failure must be fixed before Provider Core / arbitration is considered release-ready.

## Next batch

UPA-01 introduces Provider Core abstractions and Registry while keeping the existing Browser Accessibility behavior unchanged. The Session material contract frozen here remains an invariant for all later Browser DOM, UIA, Word, and PDF providers.
