# dsh-selection-companion

Windows Selection Context Bridge for DeepSeek Harness.

> Select anywhere → Continue in DeepSeek.

The repository has completed **Task 3** of the implementation plan. It is an installable DeepSeek Harness bundle, exposes the `ctx.selectionContext` Cordis capability, and now defines a versioned TypeScript ↔ Rust IPC contract that future Windows named-pipe transport will use.

## Architecture status

```text
External Windows applications
        ↓ (future providers)
Native Companion
        ↓
Task 3 IPC Contract
        ↓
dsh-selection-companion Cordis plugin
        ↓
SelectionContextService
        ↓ (future)
DeepSeek Harness Session / Agent tools
```

Task 3 deliberately does **not** open a socket or named pipe. It fixes and tests the wire contract before Task 4 introduces a real transport or Tauri UI.

## Task 1 — installable Harness bundle

- Standard Cordis plugin entry (`src/index.ts`)
- `package.json#dsh.bundle.patch`
- `cordis.patch.yml`
- `dsh plugin --profile web add ...` installation path
- TypeScript build, tests, bundle verification, `prepare`, and `prepack`

## Task 2 — Selection Context capability

- `SelectionSnapshot` for browser/PDF/Word/desktop sources
- Runtime validation of untrusted snapshot data
- Detached, deeply frozen snapshots
- Strict per-id revision ordering
- In-memory TTL and bounded retention
- `SelectionContextService` registered as `ctx.selectionContext`
- `current()`, `get()`, `update()`, `clear()`, `purgeExpired()`, and `size`

## Task 3 — versioned IPC contract

### Wire envelope

Every message uses the same envelope:

```json
{
  "protocol": 1,
  "id": "request-or-event-id",
  "type": "selection.update",
  "payload": {}
}
```

Task 3 defines these message families:

```text
bridge.hello / bridge.hello.result
bridge.ping / bridge.pong
selection.update / selection.updated
selection.current / selection.current.result
selection.expand / selection.expanded
session.list / session.list.result
session.create / session.created
session.submit / session.submitted
session.subscribe / session.subscribed
agent.event
error.response
```

The TypeScript side validates messages with **Zod** and routes `selection.update` / `selection.current.result` snapshots through the Task 2 `normalizeSelectionSnapshot()` domain validator.

The Rust side uses **serde / serde_json**, the same message-type whitelist, typed validation for the cross-language golden fixtures, and equivalent SelectionSnapshot semantic checks.

### Stream framing

The transport-neutral framing contract is:

```text
4-byte unsigned big-endian JSON byte length
+
UTF-8 JSON payload
```

V1 limits one JSON payload to **1 MiB**. Newlines inside JSON strings therefore do not affect framing. Both TypeScript and Rust include incremental frame decoders for partial and coalesced byte-stream reads.

### Request lifecycle

Both sides define deterministic pending-request trackers:

- duplicate pending request IDs are rejected
- default request timeout is 30 seconds
- expiration is explicit/deterministic rather than owning hidden timers
- `reset()` clears pending IDs after disconnect, reconnect, or Harness restart

The actual reconnect policy belongs to the future transport layer; Task 3 only fixes the lifecycle primitive.

### Shared golden fixtures

Cross-language fixtures live in:

```text
tests/protocol/
├── bridge.hello.request.json
├── bridge.hello.response.json
├── selection.update.request.json
├── session.submit.request.json
├── agent.event.json
└── error.response.json
```

The same JSON files must be accepted by TypeScript/Zod and Rust/serde tests. This is the main guard against protocol drift.

## Repository structure after Task 3

```text
src/
├── bridge/
│   ├── index.ts
│   ├── protocol.ts
│   ├── frame.ts
│   └── request-tracker.ts
├── context/
│   ├── cache.ts
│   ├── service.ts
│   └── snapshot.ts
└── index.ts

native/
└── src-tauri/
    ├── Cargo.toml
    └── src/
        ├── lib.rs
        └── protocol.rs

tests/
├── protocol.spec.ts
├── protocol/*.json
├── selection-context.spec.ts
└── bundle.spec.ts
```

`native/src-tauri` is currently a small Rust library crate only. Tauri itself is intentionally not a dependency yet; Task 4 will extend this crate into the Native Companion shell.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.x`
- Rust stable + Cargo for Task 3 cross-language tests
- A working `dsh` CLI for Harness ecosystem installation tests

## Development checks

Install JS dependencies:

```powershell
pnpm install
```

Run the normal DSH bundle gate:

```powershell
pnpm check
```

Run Task 2 only:

```powershell
pnpm test:selection
```

Run TypeScript IPC tests only:

```powershell
pnpm test:protocol
```

Run Rust IPC tests only:

```powershell
cargo test --manifest-path native/src-tauri/Cargo.toml
```

Or run the complete Task 3 gate:

```powershell
pnpm check:task3
```

### Optional Rust formatting check

```powershell
cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check
```

## What Task 3 tests

TypeScript and Rust tests cover:

- shared golden fixtures
- malformed JSON
- protocol-version mismatch
- unknown message types
- SelectionSnapshot validation at the IPC boundary
- 4-byte big-endian frame round-trip
- partial stream chunks
- multiple frames in one byte stream
- truncated frame rejection
- payloads / declared frames larger than 1 MiB
- duplicate pending request IDs
- request timeout expiry
- pending-state reset for disconnect/reconnect/Harness restart

## Manual Task 3 verification

From a clean checkout:

```powershell
git pull origin main
pnpm install
pnpm test:protocol
cargo test --manifest-path native/src-tauri/Cargo.toml
pnpm check
```

Expected result: all commands exit with code `0`.

Then ensure Task 3 did not break the actual Harness bundle:

```powershell
pnpm pack
```

Using a test Harness home/profile, reinstall the new tarball and start Harness:

```powershell
dsh plugin --profile web remove dsh-selection-companion
dsh plugin --profile web add .\dsh-selection-companion-0.1.0.tgz
dsh --profile web --dump-config | Select-String "selection-companion"
dsh web
```

Expected startup log still contains:

```text
[selection-companion] plugin loaded!
```

## Important boundaries

Task 3 still does **not** implement:

- Windows named pipe server/client
- Tauri application window
- browser extension
- Windows selection capture
- SessionController calls
- session streaming
- Agent tools

Those later features must consume the Task 2 service and Task 3 protocol rather than defining parallel state or ad-hoc JSON.

## DeepSeek Harness ecosystem contract

The package remains a normal Harness bundle:

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

and the patch resolves the installed package by npm package name:

```yaml
- insert:
    - id: selection-companion
      name: dsh-selection-companion
```

Native functionality will be connected through this Harness plugin. The Native Companion will not write Harness session files directly and will not own a separate LLM/chat history.

## License

MIT
