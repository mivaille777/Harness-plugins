# dsh-selection-companion

Windows Selection Context Bridge for DeepSeek Harness.

> Select anywhere → Continue in DeepSeek.

The repository has completed the implementation work for **Task 5**. It remains a normal DeepSeek Harness bundle, but now has a real Chrome/Edge browser selection provider that sends DOM selections through Chrome Native Messaging and the Task 4 Windows Named Pipe into `ctx.selectionContext`.

## Current architecture

```text
Chrome / Edge page
DOM Selection / input selection
        ↓
MV3 content script
        ↓
MV3 background service worker
        ↓ Chrome Native Messaging
 dsh-selection-companion-host.exe
        ↓ Protocol V1 over Task 4 framing
Windows Named Pipe
\\.\pipe\dsh-selection-companion-v1
        ↓
dsh-selection-companion Cordis plugin
        ↓
BridgeMessageRouter
        ↓
ctx.selectionContext
        ↓ (later tasks)
Harness Session / Agent tools
```

The browser extension, native host, and Tauri UI do **not** call an LLM or maintain a second chat history.

## Task 1 — installable Harness bundle

- standard Cordis plugin entry
- `package.json#dsh.bundle.patch`
- `cordis.patch.yml`
- installable with `dsh plugin --profile web add ...`

## Task 2 — Selection Context capability

- immutable validated `SelectionSnapshot`
- strict revision ordering
- in-memory TTL / bounded retention
- `SelectionContextService` at `ctx.selectionContext`

## Task 3 — versioned TypeScript ↔ Rust IPC

Protocol V1 uses:

```json
{
  "protocol": 1,
  "id": "request-id",
  "type": "selection.update",
  "payload": {}
}
```

Harness/native pipe framing is a 4-byte unsigned big-endian length followed by UTF-8 JSON, limited to 1 MiB.

## Task 4 — Native Companion + Windows Named Pipe

The Harness plugin owns `SelectionCompanionBridgeService`, a Cordis `Service` started through `Service.init` and disposed through `ctx.effect`.

The Tauri 2 companion connects to the same pipe and exposes `bridge_status`, `bridge_connect`, `bridge_ping`, and `bridge_disconnect` to its React UI.

## Task 5 — Browser Selection Provider

### Browser capture

`browser-extension/src/selection.ts` captures:

- exact selected text without rewriting its whitespace
- input / textarea selections
- document language
- nearby text before and after the selection
- nearest semantic H1–H6 heading
- bounded section/article/main text
- frame URL and document title
- top-level selection geometry when available

Selections inside frames keep `frameUrl`. Task 5 deliberately does not fabricate top-level screen geometry for framed selections.

The canonical browser snapshot declares only capabilities already implemented:

```text
localContext   true when nearby context exists
sectionContext true when section text exists
pageContext    false
screenshot     false
```

Page/document lazy expansion is a later task.

### MV3 transport

The browser extension uses:

```text
content.ts
   ↓ chrome.runtime.sendMessage
background.ts
   ↓ chrome.runtime.connectNative
io.github.mivaille777.dsh_selection_companion
```

It does **not** use localhost HTTP. A manifest regression test fails if `127.0.0.1` or `localhost` is added back to host permissions.

The background service worker converts a page capture into the canonical `SelectionSnapshot` and sends the existing Protocol V1 `selection.update` envelope to the native host.

### Native Messaging host

The Rust crate now also builds:

```text
dsh-selection-companion-host.exe
```

This is intentionally a separate binary from the Tauri GUI executable so Chrome/Edge always receive a normal stdio Native Messaging host.

Chrome Native Messaging uses its own 4-byte little-endian stdio message length. The host validates that outer framing, validates the embedded Protocol V1 message, performs a Harness `bridge.hello`, and forwards only browser-safe operations to the Task 4 pipe.

The host currently accepts:

```text
selection.update
bridge.ping
```

If the Harness pipe disappears, it drops the stale pipe client and attempts one fresh connection before returning `BRIDGE_UNAVAILABLE`.

## Repository structure

```text
browser-extension/
├── manifest.json
├── package.json
├── playwright.config.ts
├── tsconfig.json
├── vitest.config.ts
├── scripts/build.mjs
├── src/
│   ├── background.ts
│   ├── content.ts
│   ├── selection.ts
│   ├── snapshot.ts
│   └── types.ts
└── tests/
    ├── fixtures/selection.html
    ├── e2e/content.e2e.spec.ts
    └── unit/
        ├── manifest.spec.ts
        ├── selection.spec.ts
        └── snapshot.spec.ts

native/src-tauri/src/
├── bridge.rs
├── native_messaging.rs
├── protocol.rs
├── lib.rs
├── main.rs
└── bin/native_host.rs

scripts/
├── debug-selection.mjs
├── register-native-host.ps1
└── unregister-native-host.ps1
```

## Requirements

- Windows 10/11 for real Named Pipe / Native Messaging integration
- Chrome or Microsoft Edge
- Node.js `^22.19.0` or `>=24`
- pnpm `11.7.x`
- Rust stable + Cargo
- Tauri 2 Windows prerequisites / WebView2 for the GUI shell
- working `dsh` CLI

## Automated checks

Install all workspaces:

```powershell
pnpm install
```

Task 5 gate excluding the downloaded Playwright browser runtime:

```powershell
pnpm check:task5
```

Focused commands:

```powershell
pnpm test:bridge
pnpm test:native-ui
pnpm test:browser
pnpm browser:build
cargo test --manifest-path native/src-tauri/Cargo.toml
pnpm native:host:build
```

For the real Chromium fixture test, install Playwright Chromium once:

```powershell
pnpm --dir browser-extension exec playwright install chromium
```

Then run:

```powershell
pnpm check:task5:e2e
```

The Playwright test loads the built content script into a real Chromium page, creates a DOM Range selection, fires `mouseup`, and verifies the captured text, heading, nearby context, frame URL, and top-level state.

## Manual Task 5 integration test

### 1. Pull and validate

```powershell
git pull origin main
pnpm install
pnpm check:task5
```

### 2. Build the browser extension and native host

```powershell
pnpm browser:build
pnpm native:host:build
```

Expected outputs:

```text
browser-extension/dist/
native/src-tauri/target/debug/dsh-selection-companion-host.exe
```

### 3. Load the unpacked extension

Chrome:

```text
chrome://extensions
```

Edge:

```text
edge://extensions
```

Enable Developer mode, choose **Load unpacked**, and select:

```text
<repo>\browser-extension\dist
```

Copy the generated 32-character extension ID. For `file://` testing, explicitly enable file URL access for the extension.

### 4. Register the Native Messaging host

From PowerShell at repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-native-host.ps1 `
  -ExtensionId <YOUR_EXTENSION_ID>
```

The script writes a UTF-8 Native Messaging manifest under LocalAppData and registers it for both Chrome and Edge under the current user. No administrator privileges are required for the HKCU registration.

To remove it later:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\unregister-native-host.ps1
```

### 5. Start the real Harness plugin

Build and install the Harness bundle if needed:

```powershell
pnpm pack
dsh plugin --profile web remove dsh-selection-companion
dsh plugin --profile web add .\dsh-selection-companion-0.1.0.tgz
```

Start Harness:

```powershell
dsh web
```

Expected plugin/pipe logs include:

```text
[selection-companion] plugin loaded!
selection companion native bridge listening on \\.\pipe\dsh-selection-companion-v1
```

### 6. Capture a browser selection

Open a normal HTTP/HTTPS page in Chrome/Edge and select text with the mouse. Task 5 does not show the Selection Lens yet; capture is intentionally silent.

The real path is now:

```text
DOM Selection
 → content script
 → background service worker
 → Chrome Native Messaging
 → dsh-selection-companion-host.exe
 → Windows Named Pipe
 → selection.update
 → ctx.selectionContext
```

No clipboard mutation and no synthetic Ctrl+C/Ctrl+V are used.

### 7. Verify the current Harness selection

While `dsh web` is still running:

```powershell
pnpm debug:selection
```

Expected output is a real browser `SelectionSnapshot`, for example:

```json
{
  "selection": {
    "text": "The acquisition function balances exploration and exploitation"
  },
  "source": {
    "kind": "browser",
    "app": "Chrome/Edge"
  },
  "document": {
    "title": "...",
    "url": "https://...",
    "section": "3.2 Acquisition Function",
    "frameUrl": "https://..."
  },
  "provider": "browser-dom"
}
```

If the command prints:

```text
[debug-selection] no current selection
```

check the extension service worker error console and the Native Messaging registration first.

## Task 5 acceptance criteria

Task 5 is complete only when all of these are true:

1. `pnpm check:task5` passes.
2. `pnpm check:task5:e2e` passes after Playwright Chromium is installed.
3. Chrome/Edge can load `browser-extension/dist` as an unpacked MV3 extension.
4. The Native Messaging host is registered for that exact extension ID.
5. Selecting browser text causes `pnpm debug:selection` to print the same selected text from Harness state.
6. The flow works without localhost HTTP, clipboard writes, or synthetic copy/paste.

## Still not implemented

- Selection Lens / near-selection composer
- generic Windows UIA provider
- Word COM provider
- lazy page context expansion
- SessionController prompt/follow integration
- Agent `selection_current` / `selection_read_context` tools
- prebuilt binary / extension installer packaging

## DeepSeek Harness ecosystem contract

The npm package remains a standard Harness bundle:

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

The browser/native components are providers of a capability owned by that installed Harness plugin. They do not bypass Harness Session/Agent architecture.

## License

MIT
