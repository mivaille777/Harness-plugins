# P1-6 Typed IPC / Capability Boundary

Date: 2026-09-27
Repository: `mivaille777/Harness-plugins`
Branch: `feat/typed-ipc-boundary`

## Delivered and audited

- Kept all renderer-to-Tauri calls behind `native/src/api/bridge.ts`. The UI uses domain wrappers with typed inputs and results; the only raw `invoke()` call is the private implementation of that facade.
- Added a frontend command-name allowlist derived into the `NativeCommand` union. Tauri independently registers an explicit `generate_handler!` command list in `native/src-tauri/src/lib.rs`.
- Tauri commands deserialize into Rust argument types. Native handlers also validate semantic bounds for context scopes, history cursors/page sizes, session and subscription identifiers, interaction-guard leases, fixed selection material, and source-focus snapshot identity/revision.
- Removed caller-supplied `cwd` from the session-creation command. The renderer can no longer select an arbitrary working directory; Harness chooses its configured default.
- Source focus accepts only a snapshot ID and revision and resolves the recorded source identity internally. There is no renderer command that accepts a PID or launches a shell command.
- Diagnostics imports only status/probe APIs. Its active ping measures bridge health and updates diagnostic timing/error state, but it does not create, cancel, or submit a session request.

## Automated verification

| Command | Result |
|---|---|
| `pnpm --dir native exec vitest run src/api/bridge.test.ts src/App.test.tsx` | PASS; 2 files, 32 tests |
| `pnpm --dir native build` | PASS; TypeScript check and Vite production build |
| `pnpm test:rust` | PASS; 76 unit tests and 7 integration tests |
| `rustfmt --edition 2021 --check native/src-tauri/src/bridge.rs` | PASS |
| `rg -n '\binvoke\s*(?:<[^>]*>)?\s*\(' native/src` | One call site, inside the typed API facade |

## Boundary

This is a maintained-code and compile-time boundary: it centralizes renderer IPC, limits command names, and keeps native operations typed and validated. The explicit Tauri handler remains the app-level command allowlist; this phase does not add separate OS permissions or a per-window authorization system for custom commands.
