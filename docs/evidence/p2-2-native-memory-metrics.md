# P2-2 Native Process Memory Metric

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/runtime-memory-diagnostics`
Implementation commit: `debd6eb9106db4363dfaeec041a488e8f1b23a49`

## Delivered slice

- Added a read-only Tauri command that samples the Native Companion process with Windows `K32GetProcessMemoryInfo`.
- Runtime Diagnostics now displays working-set and private-byte values in MiB and includes the raw byte counts in its copyable diagnostics snapshot.
- The diagnostic payload names its scope as the Native Companion process and reports unavailable on non-Windows platforms or when the Windows API fails.
- Rust tests verify a live current-process sample and the camel-case fields consumed by the typed frontend API. UI tests verify the displayed values.

## Interpretation and limits

These are point-in-time measurements of the Native Companion process only. The Diagnostics refreshes them on its existing 10-second refresh cycle or when the user refreshes manually. They do not include Harness, browser, or system-wide memory, retain no time series, and do not establish a memory budget or long-run stability. Cache-size and window lifecycle metrics remain outstanding. No live two-hour Harness stress run was performed.

## Automated verification

| Check | Result |
|---|---|
| Focused API, Diagnostics, and App tests | PASS; 41 tests |
| `pnpm --dir native test` | PASS; 105 passed, 1 existing expected failure |
| `pnpm test:rust` | PASS; 82 unit tests and 7 integration tests |
| `pnpm --dir native build` | PASS; TypeScript check and Vite production build |
| `rustfmt --edition 2021 --check native/src-tauri/src/runtime_diagnostics.rs` | PASS |
| `git diff --check` | PASS |

The repository-wide `cargo fmt --check` still reports pre-existing formatting differences in `native/src-tauri/src/bin/pipeline_probe.rs` and `native/src-tauri/src/bin/uia_probe.rs`; this stage did not modify those files.
