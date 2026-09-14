# EC-03 — Explicit Lens context authorization

## Goal

Separate context preview from authorization. Loading `local`, `section`, or `page` context must not by itself broaden the request boundary.

## Implemented state model

Lens now keeps two separate values:

- `expandedContext`: bounded context returned for display after `Load context`.
- `authorizedMaterial`: canonical V4 material representing what the user has explicitly authorized for the current immutable snapshot revision.

The default authorization is always selection-only material produced by `selectionMaterialFromSnapshot()`.

## Authorization rules

- `Load context` clears any previous expanded authorization before requesting a new preview.
- A preview can be authorized only when its `snapshotId`, `revision`, and requested scope match the currently visible selection.
- Authorization is created only after the explicit `Use <scope> context for this request` action.
- The authorization helper copies only fields allowed by the chosen scope before canonical material validation.
- Changing the scope clears the old preview and resets authorization to selection-only.
- Changing snapshot id or revision clears the old preview and resets authorization to selection-only.
- The Lens displays the current authorization boundary independently from the preview state.

## Deliberate staging boundary

EC-03 does not yet change `submitSessionPrompt()` or the Rust `bridge_submit_prompt` command. Submission continues to use the selection snapshot until EC-04/EC-05 replace prompt/material transport with the canonical authorized material. This is intentional: explicit authorization must exist before it can affect model input.

The EC-01 expected-failure transport test therefore remains useful: the authorization control now exists, but expanded material is not considered fully delivered until the later transport stages make that test pass normally.

## Verification command

Run from the repository root:

```powershell
pnpm check:ec03
```

This includes the EC-02 gate plus Native tests for the canonical authorization helper, Lens authorization/invalidation behavior, and the existing App regression suite.

## Evidence boundary

The source and tests are committed on `feat/t05-session-integration`. A runtime PASS is not claimed here unless `pnpm check:ec03` is executed with the repository Node/Rust toolchain available.
