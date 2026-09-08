# Capture reliability and privacy

The native companion keeps at most one unpublished selection. A UI Automation event enters a capacity-one trigger channel, and a capture result replaces the latest unpublished value. The publisher reads that latest value only after the bridge is ready. This policy applies only before a selection is sent to Harness. It never replaces the exact snapshot that a user has already fixed in a Lens session submission.

The native diagnostics surface exposes a capture phase, queue depth, timestamps, error summary, and counters. It does not expose selected text or full URLs. A phase of `noSelection`, `notApplicable`, `excluded`, or `error` is status for the local capture runtime. Protocol V3 has no selection-clear message, so those phases do not delete an immutable snapshot already stored in Harness.

When the user submits an explicit Lens action, the native bridge projects that displayed snapshot into the required V3 `material` object and sends it with the normal session request. The material keeps the selected text, source, optional document identity, capture identity and revision, and fixed `selection` authorization fields. It excludes browser context, page text, geometry, capabilities, provider, and confidence. A retry retains the same Lens snapshot. Later UI Automation captures remain local/current-selection updates and cannot rewrite material already persisted in a Harness user message.

## Pause and lifecycle

`Pause capture` clears the one pending unpublished value and makes later UIA events no-ops. It is independent of the named-pipe connection: reconnecting the bridge cannot resume capture. `Resume capture` is the only local action that resumes it. The setting is intentionally process-local and resets to running on a new native-companion launch; persistent preferences require a reviewed settings owner and are not silently written by the capture runtime.

The event listener and capture worker stop when the managed runtime drops. The worker polls for shutdown at most every 250 ms and the UIA event handler is removed before its thread exits. A UIA call already in progress is allowed to finish; its result is discarded if pause or shutdown occurred meanwhile.

## Configuration

All settings are read when the native companion starts. Invalid values stop startup with a specific validation error.

| Environment variable | Default | Accepted value | Purpose |
| --- | --- | --- | --- |
| `DSH_SELECTION_CAPTURE_SETTLE_MS` | `35` | integer 0–1000 | Wait after an event before capturing. |
| `DSH_SELECTION_CAPTURE_DEDUPE_MS` | `120` | integer 0–10000 | Suppress identical rapid captures. |
| `DSH_SELECTION_CONTEXT_CHARS` | `900` | integer 1–20000 | Limit local UIA context on each side of a selection. |
| `DSH_SELECTION_CAPTURE_EXCLUDED_APPS` | empty | comma-separated lower/upper-case application or process names | Do not publish matching sources. |
| `DSH_SELECTION_CAPTURE_EXCLUDED_URL_HOSTS` | empty | comma-separated host names | Do not publish matching browser document hosts. |

Application and host exclusions are exact case-insensitive matches after trimming. They are an explicit user control, not an assertion that private or protected browser modes can be identified reliably. Password controls are excluded when UIA reports them as password controls. The default provider does not claim to identify every private window or every sensitive web page.

## Verification

Run the portable capture tests from the repository root:

~~~powershell
pnpm --dir native build
pnpm test:capture
pnpm test:native-ui
~~~

`pnpm test:capture:windows` deliberately exits with status 2 until a reviewer runs the interactive fixture and records evidence. It is a guard against treating an unexercised UIA path as a pass. With `DSH_CAPTURE_WINDOWS_FIXTURE=1`, it identifies [the fixture](../tests/fixtures/capture-windows.html) and still requires the following recorded assertions. Run `pnpm native:dev` and Harness, open the fixture in Chrome or Edge, and verify these cases with `pnpm debug:selection`:

1. Select A, then B, then C quickly; Harness receives C without an unbounded burst.
2. Pause capture, select new text, reconnect the bridge, and confirm no new snapshot appears. Resume, select again, and confirm a new snapshot appears.
3. Clear the browser selection or change focus; the native phase becomes `noSelection` or `notApplicable` without deleting an earlier Harness snapshot.
4. Verify Chinese, emoji, a long selection, and an excluded host or application using only non-sensitive fixture content.

Record the Windows, browser, DPI, Harness, and commit versions with the [test evidence template](test-evidence-template.md). A successful build or Rust test does not prove those UIA interactions.

The capture checks also do not prove a supported profile/model call to the session-bound selection tools or a visible Tauri session interaction. Record those as separate R04/R07 evidence after the focused protocol, session, tool, and native checks pass.
