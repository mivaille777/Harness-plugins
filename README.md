# dsh-selection-companion

Windows Selection Context Bridge for DeepSeek Harness.

> Select anywhere → Continue in DeepSeek.

The repository has completed **Task 4**. It is still a normal DeepSeek Harness bundle, now with a real Windows Native Companion transport: the Harness plugin owns a Node named-pipe server and a Tauri 2 / Rust companion connects to it using the Task 3 versioned IPC contract.

## Current architecture

```text
External Windows applications
        ↓ (Task 5+ providers)
Tauri Native Companion
React UI + Rust bridge client
        ↓
Windows Named Pipe
\\.\pipe\dsh-selection-companion-v1
        ↓
dsh-selection-companion Cordis plugin
SelectionCompanionBridgeService
        ↓
BridgeMessageRouter
        ↓
SelectionContextService
        ↓ (Task 9+)
DeepSeek Harness Session / Agent tools
```

The Native Companion does **not** call an LLM, write Harness session files, or maintain a second conversation history.

## Task 1 — installable Harness bundle

- Standard Cordis plugin entry (`src/index.ts`)
- `package.json#dsh.bundle.patch`
- `cordis.patch.yml`
- installable with `dsh plugin --profile web add ...`
- TypeScript build, tests, bundle verification, `prepare`, and `prepack`

## Task 2 — Selection Context capability

- `SelectionSnapshot` for browser/PDF/Word/desktop sources
- runtime validation of untrusted snapshot data
- detached, deeply frozen snapshots
- strict per-id revision ordering
- in-memory TTL and bounded retention
- `SelectionContextService` registered as `ctx.selectionContext`

## Task 3 — versioned TypeScript ↔ Rust IPC contract

Every IPC message uses:

```json
{
  "protocol": 1,
  "id": "request-or-event-id",
  "type": "bridge.ping",
  "payload": {}
}
```

Framing is:

```text
4-byte unsigned big-endian JSON byte length
+
UTF-8 JSON payload
```

Protocol V1 limits one JSON payload to 1 MiB. TypeScript validates with Zod; Rust validates with serde/serde_json plus semantic checks. Shared JSON fixtures under `tests/protocol/` are consumed by both sides.

## Task 4 — Native Companion + Windows Named Pipe

### Harness side

`SelectionCompanionBridgeService` is a real Cordis `Service`.

- starts in `Service.init`
- listens only on Windows
- defaults to `\\.\pipe\dsh-selection-companion-v1`
- can be overridden with `DSH_SELECTION_COMPANION_PIPE`
- owns all accepted sockets
- uses the Task 3 incremental frame decoder
- registers cleanup through `ctx.effect`
- closes clients and the named-pipe server when its Harness fiber is disposed

The Task 4 router currently implements:

```text
bridge.hello        → bridge.hello.result
bridge.ping         → bridge.pong
selection.update    → ctx.selectionContext.update(...)
selection.current   → ctx.selectionContext.current()
```

Protocol V1 Session messages already exist in the contract, but Task 4 returns `BRIDGE_UNAVAILABLE` for them. They will be connected to Harness Session APIs in a later task rather than mocked in the Native Companion.

### Native side

`native/` is now a Tauri 2 application using the same desktop stack already proven in AITranslator WebReBuild:

```text
React 19
TypeScript 6
Vite 8
@tauri-apps/api 2
Tauri 2
Rust
Tokio
serde / serde_json
```

The Rust side owns the named-pipe client. The browser UI only calls Tauri commands:

```text
bridge_status
bridge_connect
bridge_ping
bridge_disconnect
```

The React shell displays:

- Connected / Disconnected
- named-pipe endpoint
- Protocol V1
- connected Harness plugin version
- last ping latency
- Connect / Ping / Disconnect controls

The window is frameless, always-on-top, draggable, resizable, skipped from the taskbar, and hides on Escape.

### Important Task 4 boundary

Task 4 intentionally does **not** implement:

- browser selection capture
- UI Automation / Word providers
- selection-adjacent lens positioning
- SessionController calls
- assistant streaming
- Agent tools
- authentication / hardened pipe ACLs

The purpose of Task 4 is to prove the real transport and native shell without mixing in capture or Agent business logic.

## Repository structure

```text
src/
├── bridge/
│   ├── frame.ts
│   ├── index.ts
│   ├── protocol.ts
│   ├── request-tracker.ts
│   ├── router.ts
│   └── server.ts
├── context/
│   ├── cache.ts
│   ├── service.ts
│   └── snapshot.ts
└── index.ts

native/
├── package.json
├── index.html
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── api/bridge.ts
│   ├── App.tsx
│   ├── App.test.tsx
│   ├── main.tsx
│   ├── styles.css
│   └── test/setup.ts
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/
        ├── bridge.rs
        ├── lib.rs
        ├── main.rs
        └── protocol.rs

tests/
├── bridge-server.spec.ts
├── protocol.spec.ts
├── protocol/*.json
├── selection-context.spec.ts
└── bundle.spec.ts
```

## Requirements

- Windows 10/11 for the real Task 4 named-pipe integration test
- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.x`
- Rust stable + Cargo
- Tauri 2 Windows build prerequisites / WebView2
- a working `dsh` CLI

## Automated checks

Install the whole pnpm workspace:

```powershell
pnpm install
```

Harness/plugin tests:

```powershell
pnpm check
```

Task-specific tests:

```powershell
pnpm test:selection
pnpm test:protocol
pnpm test:bridge
pnpm test:native-ui
cargo test --manifest-path native/src-tauri/Cargo.toml
```

Full Task 4 gate:

```powershell
pnpm check:task4
```

Optional Rust formatting gate:

```powershell
cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check
```

If rustfmt reports changes:

```powershell
cargo fmt --manifest-path native/src-tauri/Cargo.toml
git diff
```

## Manual Task 4 integration test

### 1. Pull and validate

```powershell
git pull origin main
pnpm install
pnpm check:task4
```

### 2. Repack and reinstall the Harness bundle

```powershell
pnpm pack
```

If an older development copy is installed:

```powershell
dsh plugin --profile web remove dsh-selection-companion
```

Install the new tarball:

```powershell
dsh plugin --profile web add .\dsh-selection-companion-0.1.0.tgz
```

Verify composition:

```powershell
dsh --profile web --dump-config | Select-String "selection-companion"
```

### 3. Start Harness

Terminal A:

```powershell
dsh web
```

Expected logs include:

```text
[selection-companion] plugin loaded!
selection companion native bridge listening on \\.\pipe\dsh-selection-companion-v1
```

Leave this terminal running.

### 4. Start the Native Companion

Terminal B, from the repository root:

```powershell
pnpm native:dev
```

The frameless always-on-top window should appear and automatically attempt `bridge.hello`.

Expected UI state:

```text
Status          Connected
Pipe            \\.\pipe\dsh-selection-companion-v1
Protocol        v1
Harness plugin  0.1.0
```

### 5. Ping test

Click **Ping**.

Expected:

```text
Last ping       <number> ms
```

This proves the complete path:

```text
React
  ↓ Tauri invoke
Rust
  ↓ Windows Named Pipe
Harness Cordis plugin
  ↓ bridge.pong
Rust
  ↓
React
```

### 6. Disconnect / reconnect

Click **Disconnect**.

Expected state:

```text
Disconnected
```

Click **Connect**.

Expected state returns to:

```text
Connected
```

### 7. Harness restart behavior

While the Native Companion is connected:

1. stop `dsh web`
2. click **Ping**
3. the Native Companion must switch to disconnected/error state
4. restart `dsh web`
5. click **Connect**
6. it must complete a new hello handshake and return to Connected

No stale socket should be treated as a live Harness connection.

### 8. Escape behavior

With the Native Companion visible, press:

```text
Esc
```

The window should hide. During Task 4 there is no tray/hotkey re-opener yet, so stop/re-run `pnpm native:dev` to show it again.

## Custom development pipe

Both sides read the same environment variable:

```powershell
$env:DSH_SELECTION_COMPANION_PIPE='\\.\pipe\dsh-selection-companion-dev'
```

Set it in both Terminal A and Terminal B before starting Harness / Native Companion.

To temporarily load the Harness plugin without opening the Task 4 pipe during isolated tests:

```powershell
$env:DSH_SELECTION_COMPANION_DISABLE_BRIDGE='1'
```

Do not set that variable for the real Task 4 integration test.

## DeepSeek Harness ecosystem contract

The npm package is still a standard Harness bundle:

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

and `cordis.patch.yml` still contributes:

```yaml
- insert:
    - id: selection-companion
      name: dsh-selection-companion
```

The Windows companion is therefore a provider/client of a capability owned by the installed Harness plugin; it is not a separate AI application pretending to be integrated with Harness.

The current npm tarball contains the Harness bundle, not a prebuilt Native Companion executable. Prebuilt Windows binary packaging is a later release task; Task 4 launches the Native Companion from this repository source.

## License

MIT
