# EC-09 — Real Browser + Lens Expanded-Context Driver Contract

## Goal

EC-09 is the first layer that must prove the expanded-context workflow through a **real browser selection and a real Tauri Lens window**. Deterministic unit tests, Protocol V4 tests, Rust named-pipe tests, and EC-08 Session/model probes are necessary but do not substitute for this interactive acceptance layer.

Target chain:

```text
real Chrome/Edge selection
  -> Selection Companion capture/provider
  -> real Tauri Lens
  -> Load context preview
  -> explicit user authorization
  -> frozen request material preview
  -> submit
  -> Harness Session transcript
```

A missing interactive driver remains `NOT RUN`. The runner must never infer PASS from unit tests, screenshots alone, or a synthetic DOM-only browser.

## Driver schema v2

The command configured through `R07_LENS_DRIVER` must write JSON to `DSH_LENS_REPORT_PATH` with `schemaVersion: 2`.

Minimum report shape:

```json
{
  "schemaVersion": 2,
  "status": "PASS",
  "application": "tauri",
  "realWindow": true,
  "realSelection": true,
  "browser": "chrome",
  "states": ["idle", "authorized", "material", "streaming", "history"],
  "assertions": [
    "browser-selection-captured",
    "expanded-context-loaded",
    "expanded-scope-authorized",
    "request-material-matches-authorization",
    "session-transcript-observed"
  ],
  "contextAuthorization": {
    "requestedScope": "page",
    "authorizedScope": "page",
    "actualScope": "page",
    "materialScope": "page",
    "snapshotId": "<non-empty snapshot id>",
    "revision": 9,
    "previewMatchesMaterial": true,
    "requestMaterialFrozen": true
  },
  "sessionEvidence": {
    "requestId": "<non-empty request id>",
    "transcriptSource": "dsh-session",
    "transcriptObserved": true,
    "requestMaterialObserved": true,
    "transcriptContainsAuthorizedContext": true,
    "materialSnapshotId": "<same snapshot id>",
    "materialRevision": 9
  },
  "screenshots": [
    { "state": "idle", "path": "idle.png" },
    { "state": "authorized", "path": "authorized.png" },
    { "state": "material", "path": "material.png" },
    { "state": "streaming", "path": "streaming.png" },
    { "state": "history", "path": "history.png" }
  ]
}
```

The example values are illustrative. The driver must report values observed from the actual run.

## Required authorization invariants

The acceptance runner rejects the report unless all of these are true:

- `requestedScope` is `local`, `section`, or `page`; selection-only does not satisfy EC-09.
- `authorizedScope === requestedScope`.
- `actualScope === requestedScope`; no silent downgrade or widening is accepted.
- `materialScope === requestedScope`.
- `snapshotId` is non-empty and `revision` is a non-negative integer.
- the visible request-material preview matches the material that will be submitted.
- the submitted request material is frozen before submission.

The driver should choose the highest expanded scope that the fixture/provider advertises and then exercise the explicit `Use <scope> context for this request` control. Loading a preview alone is not authorization.

## Required Session invariants

The report is rejected unless:

- the submission has a non-empty logical `requestId`;
- history evidence comes from `dsh-session`, not from a UI-local echo;
- that request is observed in Session history;
- Session evidence is tied to the submitted request material;
- the transcript contains the explicitly authorized context;
- `materialSnapshotId` and `materialRevision` match the authorization evidence exactly.

A newer browser selection must not be used to satisfy history for an older request.

## Visual evidence

Each required state needs its own non-empty PNG owned by the configured screenshot directory:

- `idle` — real Lens connected before the target submission;
- `authorized` — expanded preview loaded and explicit authorization visible;
- `material` — request-material preview showing the authorized scope before submit;
- `streaming` — the Session request is actively producing an Agent response;
- `history` — the completed request is visible from Session-backed history.

A single screenshot reused for several states is not sufficient evidence.

## Privacy and data minimization

The structured driver report should contain identities and booleans needed for verification, not full captured text. In particular, do not persist the complete page/section/local context in the report. Screenshots should use the repository's non-sensitive browser fixture.

The runner itself stores only the validated metadata subset for `contextAuthorization` and `sessionEvidence`.

## Commands

Deterministic contract tests:

```powershell
pnpm test:ec09:driver-contract
```

Cumulative deterministic chain through EC-09:

```powershell
pnpm check:ec09
```

Actual real-window acceptance, after configuring a Windows GUI driver:

```powershell
$env:R07_LENS_DRIVER = '<driver executable>'
pnpm test:lens:e2e
```

Optional driver arguments must be supplied as a JSON string array in `R07_LENS_DRIVER_ARGS`; shell command strings are not accepted.

## Status rule

EC-09 may be marked `PASS` only after the real driver successfully produces a schema-v2 report and the runner validates it. If no driver is configured, or a hosted environment cannot provide a real interactive Tauri/browser desktop, status remains `NOT RUN` rather than being promoted from lower-layer tests.
