# EC-02 — Protocol V4 authorized material evidence

## Goal

EC-02 establishes one canonical, durable request-material contract before Lens authorization or prompt rendering is changed.

The contract is Protocol V4 over `\\.\pipe\dsh-selection-companion-v4` and supports four bounded scopes: `selection`, `local`, `section`, and `page`.

## Canonical invariants

- `authorizedScope` records the maximum scope explicitly authorized by the user.
- `actualScope` records the context actually frozen into this request and must never exceed `authorizedScope`.
- `selection` carries no expanded context, is always complete, and cannot be truncated.
- `local` carries only `before` and/or `after`.
- `section` carries only `sectionText`.
- `page` carries only `pageText`.
- Local filesystem `filePath` is not part of durable TypeScript material and snapshot projection in Rust clears it before submission.
- Canonical material is normalized and deeply frozen at the TypeScript durable boundary.

## Shared cross-language fixtures

The shared fixture directory now contains valid V4 submissions for selection, local, section, and page material. It also contains invalid cases for scope escalation and broader-context smuggling.

TypeScript already scans `tests/protocol/*.json` and `tests/protocol/invalid/*.json`. Rust now has `native/src-tauri/tests/protocol_fixture_parity.rs`, which scans the same directories automatically. Adding a new shared fixture therefore constrains both implementations without maintaining a second manual fixture list.

## Verification command

Run from the repository root:

```powershell
pnpm check:ec02
```

This covers TypeScript type checking, Protocol V4 tests, EC-01/EC-02 material tests, Native TypeScript build, and Rust tests.

## Evidence boundary

The code and shared fixtures are present on `feat/t05-session-integration`. This document does not claim a runtime PASS for `pnpm check:ec02` unless that command is executed in an environment with the repository toolchain installed.

One hardening item remains outside the canonical runtime projection: the Rust wire struct reuses `SelectionDocument`, whose deserializer can represent a `filePath` supplied by arbitrary external JSON even though `SelectionMaterial::from_snapshot()` clears that field and the TypeScript durable boundary strips it. A dedicated material-document wire type or explicit Rust rejection should be added before treating arbitrary third-party V4 material as trusted input.
