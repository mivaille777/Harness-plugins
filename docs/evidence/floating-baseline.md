# Floating Lens baseline

Date: 2026-09-27  
Repository: `mivaille777/Harness-plugins`  
Branch: `feat/floating-lens-state`  
Baseline commit: `c3d99fc` (`test: align fixtures with omitted optionals`)  
Baseline tag: `pre-floating-lens-baseline`

## Environment

- Windows; exact OS build was not recorded.
- Node.js `v24.11.1`
- pnpm `11.7.0`
- Rust `1.97.1`
- Cargo `1.97.1`
- Named Pipe: `\\.\pipe\dsh-selection-companion-v4`
- IPC protocol: V4

## Automated results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; lockfile unchanged |
| `pnpm run check:task5` | PASS; includes typecheck, 110 root tests, build, bundle verification, native build, Rust tests, Native UI tests, Cargo check, and browser accessibility tests |
| Rust unit and integration tests in `check:task5` | PASS; 49 unit tests, 5 Protocol V4 tests, and 2 fixture parity tests |
| Native UI tests in `check:task5` | PASS; 66 passed and 1 expected failure across 10 files |
| Browser accessibility filter in `check:task5` | PASS; 5 passed |
| `cargo fmt --manifest-path native/src-tauri/Cargo.toml --check` | FAIL; existing formatting differences in `pipeline_probe.rs`, `uia_probe.rs`, `protocol.rs`, and `providers/browser_accessibility.rs` |

The first baseline run found two Rust assertions that expected absent optional fields to serialize as explicit `null`. The current Protocol V4 contract omits those fields. The assertions were corrected to match that existing wire format; implementation code and protocol behavior were not changed. The full `check:task5` rerun then passed.

## Runtime checks and limits

- Chrome and Edge selection capture were not manually exercised.
- A live Harness Named Pipe connection and `selection.current` request were not observed during this run. Automated bridge and protocol coverage passed, but this does not establish live desktop integration.
- The browser accessibility tests cover provider logic only; they do not replace real-browser acceptance.
- No screenshot or interactive UI evidence was collected.
- The repository-wide Rust formatting check remains red on the pre-existing files listed above. The baseline test-alignment files passed that check without appearing in its formatting diff.
