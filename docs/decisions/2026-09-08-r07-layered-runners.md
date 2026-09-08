# R07 layered runner and visual-driver protocol

Date: 2026-09-08

## Decision

R07 keeps three verification layers separate. `scripts/test-session-e2e.mjs` runs an isolated supported `dsh --profile headless` process with a local deterministic OpenAI-compatible SSE endpoint for L1. It verifies profile installation, bundle composition, plugin startup, non-empty task output and a durable session file without requiring a DeepSeek credential. Its output is explicitly labelled `local-deterministic-sse`; it cannot establish a real-model result.

`scripts/test-lens-e2e.mjs` is the L3 coordinator. It never drives a shell command assembled from a string. The caller supplies an executable through `R07_LENS_DRIVER` and a JSON array through `R07_LENS_DRIVER_ARGS`. The coordinator passes the fixture, screenshot directory, report path and required states as environment variables, then validates the driver's JSON report. A report is accepted only when it declares a real Tauri window, a real Chrome or Edge selection, all required `idle`, `material`, `streaming` and `history` states, named assertions, and non-empty PNG files inside the selected screenshot directory.

Both runners use exit code `0` for the selected layer passing, `1` for an executed failure, and `2` for missing prerequisites or an unexecuted layer. Reports are written outside the temporary run root so cleanup cannot delete the evidence. Child output is bounded and credential-shaped values are redacted before persistence.

## Alternatives considered

Calling internal TypeScript functions was rejected because it would bypass the supported dsh application entry point and could pass while the shipped profile is broken. A mock provider is useful for L1 but is not evidence of a DeepSeek model response, so it is never reported as L2. A static HTML screenshot or a browser-only WebView test was rejected for L3 because it cannot prove native window focus, browser selection or monitor geometry. Shell interpolation was rejected because driver paths and arguments must remain independent process arguments.

## Consequences

The no-key path is reproducible and safe to run in CI-like environments, while real-model and native-window evidence require explicit credentials and an interactive driver. A driver implementation can evolve independently from the coordinator, but it must preserve the report schema and prove the real surfaces it claims. The coordinator does not implement session, ToolRuntime, approval or durable-log behavior; those remain product responsibilities.

## Verification

`pnpm test:r07:runner` passed 3 tests. `pnpm test:lens:runner` passed 5 tests, including rejection of a static report, missing required states, empty PNGs and directory traversal. `pnpm test:session:e2e` returned L1 `PASS` and L2 `NOT RUN` with the local deterministic SSE report. `pnpm test:lens:e2e` returned L3 `NOT RUN` because no interactive driver was configured. The complete command and environment record is in [R07 evidence](../evidence/r07-session-e2e.md).

## Remaining limits

No real DeepSeek model, host-owned R05 interaction, real Chrome/Edge UI Automation selection, process restart against a live session, or complete L3 driver has been executed. Those facts remain unverified until the corresponding environment and credentials are available.
