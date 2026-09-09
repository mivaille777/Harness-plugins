# R08.3 performance and human-factors harness evidence

Date: 2026-09-09

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Implementation commit: `4aef646507b740110fbb8e8055e6f2a44d97f9aa`.

## Delivered foundation

The repository now has a repeatable local benchmark for the captured-context projection and a schema-checked research package for perception-enhancement studies. `test:perf` measures only the local TypeScript expansion operation, records sample count and P50/P95, and lists Lens, Harness, model, recovery, CPU, and RSS lanes as unmeasured. `test:human-factors:fixtures` checks a task plan and anonymized observation fixture; `report:human-factors` requires an explicit input file and candidate SHA, rejects empty or sensitive data, and emits `DESCRIPTIVE_ONLY` descriptive summaries rather than a product-success claim.

The study fixture defines baseline and Companion conditions for term explanation, source checking, and recovery reading. Observation rows contain only anonymous identifiers, task/condition labels, outcome counts, duration, scope judgment, recovery outcome, and Raw TLX. Selection text, URLs, prompts, answers, credentials, and email fields are rejected recursively.

## Automated results

| Check | Command | Result |
|---|---|---|
| Performance helper tests | `node --test scripts/perf.test.mjs` | PASS, 2 tests |
| Local benchmark and JSON output | `pnpm test:perf` | PASS; 20 samples, 100 expansion loops per sample; P50 2.8163 ms and P95 3.2844 ms for the measured local operation |
| Human-factors helper tests | `node --test scripts/human-factors.test.mjs` | PASS, 3 tests |
| Fixture validation | `pnpm test:human-factors:fixtures` | PASS, study plan plus 2 anonymized sample rows |
| Descriptive report | `pnpm report:human-factors -- --input tests/fixtures/human-factors-observations.sample.json --candidate-sha 0000000000000000000000000000000000000000` | PASS as `DESCRIPTIVE_ONLY`; report contains one baseline and one Companion row |
| Candidate mismatch negative path | same command with candidate SHA `1111111111111111111111111111111111111111` | FAIL as required, exit code 1 |
| Missing input negative path | `pnpm report:human-factors` | FAIL as required, exit code 2 |

## Interpretation and limits

The benchmark measures a deterministic local function under one Windows development environment and does not measure Tauri paint, Native Messaging, UIA capture, Harness acceptance, model latency, disconnection recovery, CPU trend, or RSS trend. Its numbers are engineering observations, not performance budgets or user outcomes.

The checked sample fixture is synthetic and deliberately uses an all-zero candidate SHA. It proves schema and privacy behavior only. No participant was contacted, no recording was collected, and no real human-factors effect, completion-rate improvement, comprehension improvement, or workload reduction has been established. A real study must replace the fixture with consented anonymous rows and use the exact candidate SHA under review.

The product objective remains perception-enhancing reading support. Interface locale data is for UI copy only; translation is outside the product scope.
