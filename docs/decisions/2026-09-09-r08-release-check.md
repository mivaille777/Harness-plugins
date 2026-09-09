# R08.5 makes release readiness an explicit, fail-closed record

Release readiness is represented by a candidate-bound manifest rather than by the presence of build output or a successful local unit test. The validator requires the protocol and plugin versions, required scripts, required evidence paths, and one candidate SHA; PASS requires exit code 0, while NOT RUN, PENDING, and DESCRIPTIVE_ONLY remain NOT READY. A malformed manifest or failed check is FAIL.

When no manifest is supplied, `check:release` creates a PENDING skeleton and returns exit code 2. This keeps missing real-model, host, installer, browser/window, and human-factors evidence visible without pretending that local deterministic checks prove the product. The checker has no side effects outside its optional report file.

The product objective is perception-enhancing reading support. Locale selection applies to interface copy only; translation actions, prompts, and acceptance claims remain outside the release record.
