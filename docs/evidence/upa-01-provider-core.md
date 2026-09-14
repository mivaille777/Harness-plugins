# UPA-01 provider core evidence

Date: 2026-09-14

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Depends on: UPA-00 security baseline.

## Implemented behavior

UPA-01 introduces the provider-core seam without changing Protocol V3, Session material, or the active CaptureRuntime path.

New modules:

- `native/src-tauri/src/providers/types.rs`
  - `CaptureTrigger`
  - `CaptureContext`
  - `ProviderCandidate`
  - `ProviderAttempt`
- `native/src-tauri/src/providers/registry.rs`
  - provider registration
  - duplicate-id rejection
  - ordered capture attempts
  - bounded conversion of provider failures / no-selection / not-applicable outcomes
  - `browser_default(...)` factory registering the existing `BrowserAccessibilityProvider`
- `native/src-tauri/src/providers/canonicalizer.rs`
  - one-candidate validation seam
  - explicitly no cross-provider field merging

`providers/mod.rs` now exposes these modules while retaining the existing `SelectionProvider` and `ProviderCapture` contracts.

## Safety properties established

1. Registry/provider identity must agree with `SelectionSnapshot.provider`.
2. A provider error is represented as one bounded `ProviderAttempt::Error`; it does not require the whole registry to panic.
3. Registry preserves individual provider outcomes and performs no hidden winner selection.
4. Canonicalization keeps a single provider snapshot intact; no DOM/UIA/Word/PDF field mixing is introduced in this batch.
5. Existing Browser Accessibility remains the only provider in the production-equivalent default registry factory.

## Added deterministic Rust tests

The provider modules include tests for:

- duplicate provider-id rejection;
- default Browser Accessibility registration;
- ordered Candidate / NoSelection / NotApplicable / Error results;
- provider-id/snapshot-provider mismatch fail-closed behavior;
- canonicalization preserving one complete provider snapshot.

## Intended verification commands

```powershell
pnpm test:rust
pnpm test:capture
pnpm test:browser-accessibility
pnpm check:task5
```

## Execution evidence

**NOT RUN in the connector execution environment.** The execution container cannot resolve `github.com`, so a checkout cannot be created for running Cargo/pnpm. This document does not reuse historical PASS results as evidence for these commits.

A Windows/source checkout must run the commands above before UPA-01 is marked execution-verified.

## Runtime migration status

The active `CaptureRuntime` still constructs and calls `BrowserAccessibilityProvider` directly at this point. That is intentional: UPA-01 establishes the new seam without changing the live path. The live path moves to Registry → Arbitration → Canonicalizer as part of UPA-02/UPA-07 integration, where behavior equivalence and common policy handling can be tested together.
