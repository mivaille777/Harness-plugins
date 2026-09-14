# UPA-04 UIA runtime migration evidence

Date: 2026-09-14

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Baseline before this batch: `1ca33e5cb96c301a996b2c46572a9fc2bae2b0a8`

Implementation commits:

- `83a045abc2369a6113986a01e11d447b766c85c6` — route provider capture through registry arbitration and canonicalization.
- `512e54cc93b23638e66a90ccd9e276cc78e6e629` — migrate the existing UIA event and fallback-poll runtime paths to `ProviderRegistry`.

## Implemented behavior

The existing Chromium UI Automation capture path no longer calls `BrowserAccessibilityProvider.capture()` directly from `CaptureRuntime`.

Both production trigger paths now execute:

```text
UIA TextSelectionChanged / fallback poll
        -> CaptureTrigger
        -> ProviderRegistry.capture(...)
        -> ProviderRegistry.capture_all(...)
        -> ProviderCandidate validation
        -> arbitrate(...)
        -> canonicalize(...)
        -> ProviderCapture::Captured(SelectionSnapshot)
        -> existing pause/exclusion/dedupe policy
        -> latest-value queue
        -> BridgeRuntime.submit_selection(...)
        -> Protocol V3 selection.update
        -> Harness
```

The default registry contains only the existing `browser-accessibility` provider in this batch. Therefore the migration changes the internal routing seam but intentionally does not broaden the advertised application support yet.

The event path uses `CaptureTrigger::UiaEvent`. The Chromium fallback poll uses `CaptureTrigger::FallbackPoll`. This preserves trigger identity for later DOM/Word/PDF arbitration work.

## Preserved CaptureRuntime policy

The migration intentionally leaves the following behavior after arbitration, rather than moving it into any provider:

- pause check before capture;
- settle delay for UIA events;
- second pause check after provider work;
- application and URL-host exclusions;
- event-path deduplication window;
- fallback-poll persistent fingerprint suppression;
- fingerprint reset on `NoSelection` / `NotApplicable`;
- bounded latest-value mailbox and coalescing;
- Named Pipe publication through `BridgeRuntime`;
- content-free `selection-captured` Tauri notification.

This means a future provider can supply a candidate but cannot directly bypass the common privacy/admission or publication path.

## Registry arbitration behavior added for runtime use

`ProviderRegistry.capture(trigger)` now converts provider attempts into exactly one legacy runtime result only after arbitration and canonicalization.

Covered deterministic cases in `providers::registry::tests` include:

1. same fresh selection from Browser DOM and Browser UIA -> arbitration selects the richer/higher-priority candidate;
2. fresh providers disagree on selected text -> fail closed with an arbitration conflict;
3. one optional provider fails while another produces a valid candidate -> the valid candidate can continue;
4. a healthy applicable provider reports `NoSelection` while an unrelated optional provider errors -> ordinary `NoSelection` is preserved;
5. provider identity mismatch remains a bounded provider error;
6. canonical output remains one provider snapshot; no cross-provider field merge occurs.

The capture-time arbitration context is updated after provider reads before freshness scoring. This prevents a slow but otherwise valid capture from appearing future-dated merely because the provider completed after the trigger timestamp.

## Safety boundary unchanged

This batch does **not** modify:

- `SelectionSnapshot` wire schema;
- `SelectionMaterial` schema;
- the selection-only authorization boundary;
- `session.submit.material` requirements;
- durable `selection-companion` user-message material;
- `selection_current` / `selection_read_context` Agent-scoped resolution;
- request retry material freezing;
- Session or Agent ownership.

The UPA-00 rule that local `document.filePath` may exist in a Native snapshot but is removed before `SelectionMaterial` remains in force.

## Connector-level diff verification

GitHub compare from `1ca33e5cb96c301a996b2c46572a9fc2bae2b0a8` to `512e54cc93b23638e66a90ccd9e276cc78e6e629` reports exactly two modified files:

- `native/src-tauri/src/capture.rs`
- `native/src-tauri/src/providers/registry.rs`

No Session, bridge protocol, Material, Agent tool, Lens UI, or browser-provider capture implementation file changed in this migration.

## Required automated verification

Run on a checkout containing Rust, Node, pnpm, and the repository dependencies:

```powershell
pnpm test:capture
pnpm test:browser-accessibility
pnpm test:rust
pnpm check:task5
cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check
pnpm test:bridge:integration
```

Expected result for a merge/release candidate: all commands `PASS`, exit code `0`.

The focused Rust suite must include the new `providers::registry::tests` cases in addition to the existing `capture::tests` and browser-accessibility tests.

## Required Windows UIA verification

Run on a real Windows desktop with Chrome and/or Edge:

```powershell
pnpm test:capture:windows
```

Then manually confirm at least these product-path facts:

1. a normal browser text selection reaches `selection.current` with provider `browser-accessibility`;
2. event-triggered selection still publishes once after the settle delay;
3. when a Chromium page does not emit `Text_TextSelectionChanged`, fallback polling still publishes the selection;
4. repeated fallback reads of the same active selection do not republish every 500 ms;
5. clearing the selection and selecting the same text again can produce a fresh capture;
6. `DSH_SELECTION_CAPTURE_EXCLUDED_APPS` and `DSH_SELECTION_CAPTURE_EXCLUDED_URL_HOSTS` work on both event and fallback paths;
7. pausing capture before or during provider work prevents publication;
8. Harness receives the same canonical snapshot shape as before this migration.

## Current execution status

The connected environment used to author this batch cannot execute the Rust/Windows verification commands:

- `rustc` is not installed (`rustc: command not found`);
- direct container access to `github.com` cannot resolve the host, so the repository cannot be cloned into the execution container;
- therefore automated Rust, Tauri, Windows UIA, Named Pipe, and DeepSeek Harness product-path tests are **NOT RUN** in this environment.

The code and evidence were written through the connected GitHub API. The connector-level branch/commit/diff checks completed successfully, but they are not substitutes for compilation or runtime tests.

## Exit gate for UPA-04

UPA-04 should be considered implementation-complete but runtime-unverified until the required automated and Windows commands above are rerun against the current candidate SHA and recorded as PASS/FAIL/NOT RUN.

Browser DOM, Word COM, PDF-specific capture, real multi-provider foreground arbitration, and DeepSeek Harness ToolRuntime E2E remain later batches and are not claimed by this evidence.
