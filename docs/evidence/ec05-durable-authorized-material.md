# EC-05 — Durable Authorized Material Transport

## Goal

Carry the exact canonical material produced by explicit Lens authorization through:

```text
Lens
  -> Tauri invoke
  -> Rust
  -> Protocol V4 Named Pipe
  -> session.submit.material
  -> SelectionCompanionSessionService
  -> durable user/message.source.material
```

without rebuilding the material from global/current selection state.

## Native boundary

`native/src/api/bridge.ts` keeps a temporary compatibility signature:

- argument 4 is the legacy `SelectionSnapshot` fallback;
- argument 5 is the canonical `SelectionMaterial` used by the Lens path.

When argument 5 is supplied, the Tauri `material` parameter is exactly that canonical object.

`native/src/App.tsx` freezes both the generated prompt and the canonical material into `pendingSubmission`. An unknown-submission retry therefore reuses:

- the same logical request identity;
- the same prompt;
- the same canonical material object.

It does not read a newer selection or recompute authorization.

## Rust boundary

`native/src-tauri/src/submission_material.rs` normalizes the command input:

1. canonical `SelectionMaterial` is parsed and validated first;
2. invalid canonical material fails closed;
3. a legacy `SelectionSnapshot` is accepted only as a compatibility fallback and is projected to selection-only material.

The registered Tauri command now lives in `native/src-tauri/src/submission.rs` and sends the validated canonical material directly as Protocol V4 `session.submit.material`.

The legacy submit command in `bridge.rs` is no longer the handler registered by `lib.rs`; the rest of `BridgeRuntime` still owns capture, expansion, history, subscription, and cancellation.

A Windows named-pipe integration test in `submission.rs` verifies that authorized local scope and its context sentinel survive into the actual V4 submit frame.

## Harness durable boundary

`SelectionCompanionSessionService.submit()` already accepts `SelectionMaterial` and includes it in the submission fingerprint.

`acceptSubmission()` stores the same material in:

```text
user/message.source = {
  kind: 'selection-companion',
  requestId,
  deliveryMode,
  contentDigest,
  material
}
```

No additional production change was required on the TypeScript session side.

`tests/ec05-session-persistence.spec.ts` verifies that expanded canonical material remains present in the durable message source rather than being reduced to selection-only material.

## Automated coverage

- `native/src/api/bridge.test.ts`
  - legacy snapshot fallback remains available;
  - canonical material takes precedence at Tauri invoke;
  - unknown submission preserves request identity.
- `native/src/ec05-durable-material.test.tsx`
  - Lens passes frozen canonical expanded material as the fifth submit argument;
  - unknown retry reuses the same material object.
- `native/src-tauri/src/submission_material.rs`
  - canonical expanded material is preserved;
  - legacy snapshot becomes selection-only;
  - invalid scope escalation is rejected.
- `native/src-tauri/src/submission.rs`
  - Windows pipe test verifies exact authorized scope/context in Protocol V4 submit material.
- `tests/ec05-session-persistence.spec.ts`
  - session service persists expanded canonical material in `user/message.source.material`.

Verification command:

```powershell
pnpm check:ec05
```

`check:ec05` chains EC-01 through EC-04, Native API/UI coverage, and Rust tests. The root `pnpm test` executed earlier in the chain also discovers the EC-05 session persistence test.

## Remaining boundary

EC-05 makes expanded authorization durable, but the Agent tool `selection_read_context` is still intentionally selection-only. The next stage must make tool reads scope-aware using only the persisted material for the current durable turn:

```text
selection_read_context(scope)
  -> resolve tool call to durable turn
  -> resolve persisted SelectionMaterial
  -> verify requested scope <= authorizedScope and is available in actualScope
  -> return only that persisted context
```

No tool may call global `selectionContext.current()` or re-expand a live/newer selection.

## Verification status

The implementation, fixtures, and verification command are committed. This document does not claim a runtime PASS until `pnpm check:ec05` is executed in a checkout with the required Node/Rust/Windows toolchain.
