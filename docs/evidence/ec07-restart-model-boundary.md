# EC-07 — Restart / Replay / Model Boundary

## Goal

Verify two properties that cannot be inferred from UI state alone:

1. an expanded authorized request remains bound to its original material across Session service restart/recovery;
2. the actual OpenAI-compatible request emitted by DSH contains the authorized selection/context sentinels and excludes preview-only data.

The target chain is:

```text
fixed Snapshot A
  -> explicit page authorization
  -> canonical prompt + canonical SelectionMaterial
  -> durable Harness submission
  -> service restart
  -> same requestId resolves to the original durable request
  -> DSH model request contains authorized material
```

## Restart / replay evidence

`tests/ec07-session-restart.spec.ts` creates a page-authorized material with:

- selection sentinel: `EC07_SELECTED_TOKEN_A`;
- page sentinel: `EC07_PAGE_CONTEXT_SENTINEL_83917`;
- snapshot/revision: `snapshot-ec07-a` / `7`.

The first Session service submits it normally and captures the durable Harness user message. The fixture then reconstructs a restarted service from a durable `agent/inbox/spliced` event.

The test requires:

- resubmitting the same `sessionId + requestId + content + material` returns `duplicate: true`;
- no second `followup()` is issued;
- resumed Agents still register the selection tools;
- attempting to reuse the same requestId with Snapshot B / revision 8 / different page material fails because the durable content/material fingerprint differs.

This proves request recovery does not rebind to a newer selection.

## Model-boundary probe

`scripts/ec07-model-boundary.mjs` is a keyless deterministic model-boundary runner.

It starts a local OpenAI-compatible SSE endpoint and runs a real DSH profile against it. The request sent to the local model must contain:

- `EC07_SELECTED_TOKEN_A`;
- `EC07_PAGE_CONTEXT_SENTINEL_83917`.

It must not contain:

- `EC07_UNAUTHORIZED_PREVIEW_SENTINEL`.

The probe intentionally does **not** retain full model prompts. For each model request it records only:

- method/path;
- model name;
- message count;
- expected-sentinel booleans;
- forbidden-sentinel booleans;
- SHA-256 of serialized messages.

This is sufficient to prove model-input inclusion/exclusion without writing captured source text into the evidence artifact.

Unit coverage for this privacy boundary is in `scripts/test-ec07-model-boundary.mjs`.

## Commands

Deterministic test chain through EC-07:

```powershell
pnpm check:ec07
```

This includes EC-01 through EC-06 plus:

- `tests/ec07-session-restart.spec.ts`;
- privacy-safe model-probe unit tests.

Actual DSH → local model boundary probe:

```powershell
pnpm test:ec07:model-boundary
```

The executable runner writes a safe report named:

```text
ec07-model-boundary.json
```

under `EC07_ARTIFACT_ROOT` or the default R07 report directory.

## Interpretation

`check:ec07` and `test:ec07:model-boundary` prove different things and must not be conflated.

- `check:ec07` validates deterministic code contracts and restart behavior.
- `test:ec07:model-boundary` validates an actual DSH model request using a local deterministic model endpoint.
- `test:lens:e2e` remains the real Chrome/Edge + Tauri L3 acceptance path.

A missing local DSH/toolchain environment must be reported as `NOT RUN`, not `PASS` and not a product-code failure.

## EC-07B remaining replay boundary

The Session submission recovery path already resolves `agent/inbox/spliced` durable messages. The Agent tool resolver currently binds tool calls primarily from the turn's persisted `user/message` event.

Before claiming arbitrary raw-log replay support for tool calls, EC-07B must verify the exact Harness event ordering on resume and, if required, teach the tool resolver to associate a pre-turn `agent/inbox/spliced` selection message with the next durable turn without allowing cross-turn leakage.

Until that event-order proof is complete, the supported invariant remains:

```text
tool call -> durable turn -> persisted selection-companion user/message -> canonical material
```

No tool is allowed to fall back to global current selection or live context expansion.

## Verification status

Implementation and verification commands are committed. No runtime PASS is claimed in this document until the commands are executed in an appropriate checkout/toolchain. Real browser/Tauri acceptance is still a separate L3 step.
