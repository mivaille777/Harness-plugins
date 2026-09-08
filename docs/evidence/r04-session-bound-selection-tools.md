# R04 session-bound selection tools evidence

Date: 2026-09-08

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Introduced by commit: `5ec3a8a`

Environment: Windows, Node.js `v24.11.1`, pnpm `11.7.0`, rustc and cargo `1.97.1`

## Implemented behavior

Protocol V3 makes `session.submit.material` mandatory and isolates the default named pipe from V2 peers. The material is a strict, minimal, selection-only projection saved in the durable source of the accepted user message. The request fingerprint covers it. Rust `null` optional wire values are normalized to omitted fields before they reach durable JSON.

Both selection tools are registered in the correct Harness Agent scope during create and resume. At execution they locate the tool call, its durable turn, and the latest preceding companion user message in that turn. The result cannot use a global selection, Native capture state, prompt parsing, another Agent, another session, or unapproved surrounding context. Native unknown-submit recovery retains the same frozen material.

## Automated and integration evidence

| Evidence | Command | Result |
|---|---|---|
| Root TypeScript program | `pnpm typecheck` | PASS, exit 0 |
| Session service and bridge routing | `pnpm test:session` | PASS, exit 0, 2 files and 21 tests |
| Durable session replay | `pnpm test:session:replay` | PASS, exit 0, 1 file and 3 tests |
| Scoped ToolRuntime and Agent setup | `pnpm test:session:tools` | PASS, exit 0, 1 file and 7 tests |
| Lens session projection and Native API | `pnpm test:lens:session` | PASS, exit 0, 3 files and 26 tests |
| Cross-language protocol, Native build, and Rust | `pnpm test:contract` | PASS, exit 0; 12 protocol tests, 24 frontend modules, and 25 Rust tests |
| Real Windows Node/Rust named pipe | `pnpm test:bridge:integration` | PASS, exit 0; 100 ordered events, concurrent ping/submit, and zero remaining clients or listeners |
| Root build | `pnpm build` | PASS, exit 0 |
| Bundle composition | `pnpm verify:bundle` | PASS, exit 0 |
| Rust formatting | `cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check` | PASS, exit 0 |
| Patch hygiene | `git diff --check` | PASS, exit 0 |

The focused tests include strict V3 fixtures, missing/invalid/blank material rejection, Rust-null optional-field normalization through durable JSON and service reconstruction, request-fingerprint conflicts, Agent resume, Agent and session isolation, same-turn material selection, missing material, denied scope expansion, cancellation, registration disposal, Native fixed-material retry, and V2 pipe incompatibility.

## Evidence limits

Evidence is U/I level plus W-level real Windows named-pipe transport. It does not run a supported `dsh` profile, invoke a real model, observe host approval policy, start a visible Tauri window, capture a browser selection, take a product screenshot, or restart a real dsh process and session directory. These are NOT RUN product-path checks owned by R05 through R07; they are not implied by the passing fixture, ToolRuntime, or pipe tests.
