# P2-1 Provider Expansion Status

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/provider-arbitration-audit`

## Existing provider foundation

- `SelectionProvider`, `ProviderCandidate`, `ProviderRegistry`, snapshot canonicalization, and deterministic arbitration are implemented.
- The production `CaptureRuntime` sends both UIA selection events and fallback polls through the registry, candidate validation, arbitration, and canonicalization before applying shared capture policy.
- Arbitration rejects stale and future-dated snapshots, rejects known foreground-process mismatches, fails closed when eligible providers disagree on selection text, and ranks agreeing candidates deterministically.
- The default native registry currently contains only `browser-accessibility`. The browser extension has its own DOM snapshot path through `selection.update`; it is not currently a candidate in the native registry.
- `CaptureRuntime` currently constructs the capture context without a foreground process/window identity, so foreground mismatch filtering is available to callers and covered by policy tests but is not active in the current production capture path.

## Provider scope

The taskbook marks Generic UIA, Word COM, and PDF providers as future work and DOM integration as optional. They are not claimed as supported native providers here. The separate integration guide also leaves optional desktop providers to actual user need. Adding another provider to the capture loop before measuring its UIA cost and validating its selection semantics could increase latency or create cross-source conflicts.

This records the completed provider seam and arbitration foundation while keeping the production support claim limited to what is registered and tested. Native multi-provider arbitration between DOM and UIA, Generic UIA, Word COM, and PDF-specific capture remain follow-up work.

## Automated verification

| Command | Result |
|---|---|
| `pnpm test:capture` | PASS; 6 capture tests |
| `pnpm test:rust` | PASS; 76 unit tests and 7 integration tests |
| `pnpm --dir browser-extension test` | PASS; 4 files, 8 tests |
| `rustfmt --edition 2021 --check native/src-tauri/src/providers/registry.rs native/src-tauri/src/providers/arbitrator.rs native/src-tauri/src/providers/browser_accessibility.rs native/src-tauri/src/capture.rs` | PASS |

The automated tests validate provider arbitration with deterministic candidates. The Windows capture script intentionally reports NOT RUN until an interactive Chrome/Edge fixture has been opened; live provider, foreground switching, and repeated-selection behavior remain manual desktop evidence.
