# UPA-02 provider arbitration evidence

Date: 2026-09-14

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Depends on: UPA-00 security baseline and UPA-01 provider core.

## Implemented behavior

UPA-02 introduces a deterministic, provider-neutral arbitration engine in `native/src-tauri/src/providers/arbitrator.rs`.

The engine performs hard filtering before quality ranking:

1. stale candidate rejection;
2. excessive future-skew rejection;
3. known foreground-process mismatch rejection;
4. conflict fail-closed when multiple still-eligible providers report different selected text;
5. deterministic ranking only when eligible providers agree on selected text.

Default freshness bounds are intentionally explicit and testable:

- maximum candidate age: 3000 ms;
- maximum future skew: 1000 ms.

Quality ranking currently prefers source-specific rich providers over generic fallbacks:

- `browser-dom`
- `word-com`
- `pdf-accessibility`
- `browser-accessibility`
- `generic-uia`

Document/context richness and confidence only influence ranking after safety filters. Confidence cannot grant context scope, bypass freshness, bypass foreground matching, or resolve conflicting selected text.

## Fail-closed rule

UPA-02 deliberately does not merge candidate fields. If two fresh, foreground-compatible candidates contain different selected text, the result is `ArbitrationResult::Conflict` rather than a synthetic hybrid snapshot.

This preserves the UPA-00 rule that a final `SelectionSnapshot` must remain attributable to one provider before it is projected to `SelectionMaterial`.

## Added deterministic cases

The Rust tests in `arbitrator.rs` cover:

- Browser DOM wins over Browser UIA when both describe the same fresh selection;
- stale DOM is rejected and fresh Browser UIA wins;
- Word COM wins over generic UIA for the same Word selection;
- fresh, conflicting DOM/UIA text fails closed;
- foreground mismatch is rejected before scoring;
- PDF-specific accessibility wins over generic UIA;
- deterministic provider ranking does not use confidence as an authorization decision.

## Intended verification commands

```powershell
pnpm test:rust
pnpm test:capture
pnpm test:browser-accessibility
pnpm check:task5
```

## Execution evidence

**NOT RUN in the connector execution environment.** The available container cannot resolve `github.com` and has no Rust toolchain, so these new Rust tests could not be executed here. No historical PASS is reused as evidence for UPA-02.

The next Windows/source-checkout verification must execute the commands above before UPA-02 is marked execution-verified.

## Integration status

The arbitration engine is currently pure and deterministic; the active `CaptureRuntime` is not yet routed through it. That runtime migration is intentionally deferred until the Registry, policy, and arbitration contracts are all frozen, so the behavioral change can be reviewed as one integration step rather than being spread across provider-core commits.
