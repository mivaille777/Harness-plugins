# Protocol V4 authorized context material

## Decision

Protocol V4 replaces the V3 selection-only wire contract for Selection Companion session submissions. Every `session.submit` still carries one immutable, request-bound `material` object, but the canonical material can now describe explicitly authorized `selection`, `local`, `section`, or `page` context.

The material records both `authorizedScope` and `actualScope`. `actualScope` may be narrower than the user's authorization when the provider can only return a bounded fallback, but it can never exceed `authorizedScope`. `completeness` is `complete` or `partial`; `truncated` records bounded projection loss for expanded material.

The context shape is scope-specific:

- `selection` carries no expanded context and is always complete and non-truncated.
- `local` carries only `before` and/or `after`.
- `section` carries only `sectionText`.
- `page` carries only `pageText`.

A material that mixes broader context into a narrower actual scope is rejected. This prevents a request authorized for local context from smuggling section or page text into durable session state.

The default projection from a `SelectionSnapshot` remains selection-only. Merely capturing or previewing surrounding context does not authorize it. Local filesystem paths are removed when Native projects a snapshot into session material and are also stripped by the TypeScript durable-material normalizer.

## Version boundary

The semantic expansion is a protocol change, not a silent reinterpretation of V3. `IPC_PROTOCOL_VERSION` is 4 and the default Windows transport endpoint is `\\.\pipe\dsh-selection-companion-v4` on both Harness and Native sides. A V3 frame is rejected before payload dispatch.

Shared positive and negative fixtures are labeled V4. Negative fixtures therefore fail because of their intended schema or invariant violation instead of being masked by a protocol-version mismatch.

## Durable-session behavior

The existing session service remains the durable authority. The complete normalized material participates in the request fingerprint and is stored in the `selection-companion` source of the Harness user message. Reconstructing request material after retry or restart must use that durable source rather than current capture state.

V4 changes what the durable material can represent; it does not grant new read authority by itself. `selection_read_context` remains selection-only in EC-02. Expanded tool reads are introduced separately in EC-07 and must resolve only the material already persisted for that tool call's request/turn.

## Product boundary

EC-02 does not make the Lens send expanded context. The current Lens `Load context` interaction remains a preview. Explicit authorization state and construction of an expanded canonical material belong to EC-03 through EC-05. Until that work lands, normal product submissions continue to use the selection-only projection even though the V4 protocol can validate and persist broader material.

## Verification

Run from the repository root:

```powershell
pnpm check:ec02
```

The command covers TypeScript type checking, Protocol V4 parsing/fixtures, canonical material invariants, Native TypeScript build, and Rust protocol tests. The repository connection does not currently expose a CI check for the latest branch commit, so this decision does not claim the command has run successfully on a real checkout until such evidence is recorded.
