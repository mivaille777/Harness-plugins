# dsh-selection-companion

Windows Selection Context Bridge for DeepSeek Harness.

> Select anywhere → Continue in DeepSeek.

The project is a normal DeepSeek Harness / Cordis bundle with a Windows Native Companion. The default browser path is now **extensionless**: Chrome, Edge, and Chromium-family selections are captured through Windows UI Automation and forwarded through the existing Harness named-pipe capability.

The optional MV3 extension / Chrome Native Messaging implementation remains in the repository as a future DOM-rich provider, but installing a browser extension is no longer part of the default product path.

## Current architecture

```text
Chrome / Edge / Chromium
ordinary browser, no extension required
        ↓
Windows UI Automation
Text_TextSelectionChanged
        ↓
CaptureRuntime
        ↓
BrowserAccessibilityProvider
TextPattern.GetSelection()
        ↓
SelectionSnapshot
        ↓
Tauri / Rust Native Companion
        ↓ Protocol V3
Windows Named Pipe
\\.\pipe\dsh-selection-companion-v3
        ↓
dsh-selection-companion Cordis plugin
        ↓
BridgeMessageRouter
        ↓
ctx.selectionContext
        ↓
Harness Session / Agent services
durable request material + Agent-scoped selection tools
```

The Native Companion does **not** call an LLM, write Harness Session files directly, or maintain a second conversation history.

## Task 1 — installable Harness bundle

Completed:

- standard Cordis plugin entry
- `package.json#dsh.bundle.patch`
- `cordis.patch.yml`
- installable with `dsh plugin --profile web add ...`

## Task 2 — Selection Context capability

Completed:

- validated immutable `SelectionSnapshot`
- strict per-id revision ordering
- in-memory TTL and bounded retention
- `SelectionContextService` at `ctx.selectionContext`

## Task 3 — versioned TypeScript ↔ Rust IPC

Protocol V3:

```json
{
  "protocol": 3,
  "id": "request-id",
  "type": "selection.update",
  "payload": {}
}
```

Harness/native pipe framing is a 4-byte unsigned big-endian JSON length followed by UTF-8 JSON, limited to 1 MiB. V3 does not negotiate with V2. In V3, every `session.submit` also carries a required, strict `material` object: the fixed snapshot identity, revision, capture time, selected text, source, optional document identity, and the literal `selection` authorization and actual scopes. The current material is complete only for the selected text; it excludes provider context, geometry, confidence, and page expansion data.

## Task 4 — Native Companion + Windows Named Pipe

The Harness plugin owns `SelectionCompanionBridgeService`, a Cordis `Service` started through `Service.init` and disposed through `ctx.effect`.

The Tauri 2 companion owns the native pipe client and exposes the transport status to its React shell.

The bridge currently handles:

```text
bridge.hello
bridge.ping
selection.update
selection.current
selection.expand
session.list
session.history
session.create
session.submit
session.subscribe
session.cancel
agent.event
```

`session.history` 返回有界 durable history page，并带有原始日志的 `capturedThroughCursor`。Lens 按 `nextCursor` 读取后从该高水位订阅；Native 的 list/create/history 请求复用 request/reply 管道，事件订阅使用独立管道，切换时通过 `bridge_unsubscribe_session` 精确释放旧订阅。

`BridgeRuntime::submit_selection(...)` is the single native path used to persist captured selections into Harness state.

`BridgeRuntime::submit_prompt(...)` projects the exact Lens snapshot into the V3 `session.submit.payload.material` object. The native retry path preserves that same snapshot instead of reading the newest global capture. Harness persists the material with the normal `selection-companion` user-message source, so a later browser selection cannot replace the material associated with an earlier request.

`selection.expand` is an explicit, bounded reference-preview request. It can expose only local, section or page text already captured in the immutable snapshot, returns the snapshot revision and completeness/truncation metadata, and never changes the fixed material submitted to Harness. The Lens makes this request only after the user chooses a scope and presses **Load context**; it does not fetch a page or silently add context to a model request.

## Task 5 — Extensionless Browser Accessibility Provider

Task 5 has been redesigned so a normal user does **not** need to install a Chrome/Edge extension.

### Default provider

```text
provider = browser-accessibility
```

The Windows-only implementation uses pinned `uiautomation = 0.16.1`, compatible with the repository's current Rust 1.77 / edition 2021 baseline.

The provider:

- detects a Chromium-family foreground accessibility tree through `Chrome_WidgetWin_*`
- queries `TextPattern.GetSelection()` instead of synthesizing Ctrl+C
- rejects collapsed / empty selections
- preserves the selected text returned by the accessibility range
- derives bounded local context before and after the selection
- expands the current range to a paragraph for section-level context
- searches nearby accessibility headings without depending on localized labels
- reads browser title / document title where available
- searches the browser chrome for a URL-bearing Edit + ValuePattern
- emits a conservative screen-space geometry anchor from the enclosing accessibility element
- dynamically calculates capabilities and confidence
- detects obvious `.pdf` browser documents as `source.kind = "pdf"`

Current capabilities are intentionally bounded:

```text
localContext   dynamic
sectionContext dynamic
pageContext    false
screenshot     false
```

Full page/document expansion remains a later task.

### Automatic selection trigger

The Native Companion registers the Windows UI Automation event:

```text
Text_TextSelectionChanged
```

on the desktop accessibility subtree.

The event callback does no expensive capture work. It only sends a bounded trigger to `CaptureRuntime`:

```text
UIA event
   ↓ capacity-1 trigger channel
35 ms settle delay
   ↓
BrowserAccessibilityProvider.capture()
   ↓
120 ms signature dedupe
   ↓
BridgeRuntime.submit_selection()
```

This avoids a global mouse hook for the primary implementation and prevents bursts of duplicate UIA events from creating duplicate Harness snapshots.

Task 2 adds a second bounded, latest-value mailbox between capture and publish. It retains one unpublished snapshot at most; a slower bridge receives the newest material rather than an unbounded backlog. The native diagnostics window can pause capture without disconnecting Harness. Pause clears only unpublished local material, and reconnecting cannot resume it. See [capture reliability and privacy](docs/capture-reliability.md) for configuration, privacy exclusions, state meanings, and the required Windows evidence.

The Browser provider owns one UI Automation session for the lifetime of its capture worker rather than repeatedly initializing COM for every selection.

### SelectionSnapshot example

```json
{
  "selection": {
    "text": "exploitation"
  },
  "source": {
    "kind": "browser",
    "app": "Google Chrome",
    "process": "chrome.exe"
  },
  "document": {
    "title": "Safe Bayesian Optimization",
    "url": "https://example.com/paper",
    "section": "3.2 Acquisition Function"
  },
  "context": {
    "before": "The acquisition function balances exploration and",
    "after": "under uncertainty.",
    "sectionText": "The acquisition function balances exploration and exploitation under uncertainty.",
    "pageAvailable": false
  },
  "provider": "browser-accessibility"
}
```

### Geometry note

`uiautomation 0.16.1` does not currently wrap `IUIAutomationTextRange::GetBoundingRectangles`, so Task 5 uses the enclosing accessibility element rectangle as a conservative anchor.

Task 6 can refine exact range geometry for the near-selection Lens without changing `SelectionSnapshot` or the provider abstraction.

## Provider seam

Native selection sources now implement a common capability seam:

```rust
pub trait SelectionProvider {
    fn id(&self) -> &'static str;
    fn capture(&self) -> Result<ProviderCapture, String>;
}
```

Current/future providers:

```text
BrowserAccessibilityProvider  default browser provider
Browser DOM extension         optional rich provider
Generic Windows UIA           later task
Word COM                      later task
```

This keeps capture source details outside the Harness transport and Session layers.

## Optional Browser DOM extension

The existing `browser-extension/` and `dsh-selection-companion-host.exe` implementation is retained as an optional rich-context provider.

Its path is:

```text
MV3 content script
   ↓
MV3 background
   ↓ Chrome Native Messaging
optional native host
   ↓
Task 4 Named Pipe
   ↓
Harness
```

It does not use localhost HTTP. Windows Native Messaging stdio is explicitly switched to `O_BINARY` before Chrome framing is read or written.

This optional path may later be useful when exact DOM/iframe semantics are worth the additional browser installation step. It is **not required** for normal Task 5 operation.

## Repository structure

```text
native/src-tauri/src/
├── bridge.rs
├── capture.rs
├── native_messaging.rs
├── protocol.rs
├── providers/
│   ├── mod.rs
│   └── browser_accessibility.rs
├── lib.rs
├── main.rs
└── bin/native_host.rs

browser-extension/                 optional
├── manifest.json
├── src/
│   ├── background.ts
│   ├── content.ts
│   ├── selection.ts
│   ├── snapshot.ts
│   └── types.ts
└── tests/

scripts/
├── debug-selection.mjs
├── register-native-host.ps1       optional extension path
└── unregister-native-host.ps1     optional extension path
```

## Requirements

Default extensionless path:

- Windows 10/11
- Chrome, Microsoft Edge, or compatible Chromium browser
- Node.js `^22.19.0` or `>=24`
- pnpm `11.7.x`
- Rust stable + Cargo
- Tauri 2 Windows prerequisites / WebView2
- working `dsh` CLI

## Windows installer candidate

The Native Companion builds as an unsigned, current-user NSIS installer. Building does not register the optional browser extension or remove Harness session data.

```powershell
pnpm native:build
pnpm test:installer
pnpm test:installer:smoke
```

`test:installer:smoke` uses a unique directory below the Windows temporary folder, launches the installed executable, repeats installation, uninstalls it, and fails when executable files remain. It is an actual current-user installation test; code signing, another clean user or VM, cross-version migration, and public distribution require separate release evidence.

A browser extension is **not** a default requirement.

## Automated checks

Install workspaces:

```powershell
pnpm install
```

Full extensionless Task 5 gate:

```powershell
pnpm check:task5
```

Focused commands:

```powershell
pnpm test:bridge
pnpm test:bridge:integration
pnpm test:native-ui
pnpm test:lens
pnpm test:lens:session
pnpm test:session
pnpm test:session:transport
pnpm test:session:replay
pnpm test:session:tools
pnpm test:browser-accessibility
pnpm test:capture
cargo test --manifest-path native/src-tauri/Cargo.toml
cargo check --manifest-path native/src-tauri/Cargo.toml
```

The native Lens fixes a retrieved selection and provides Explain and Ask controls for perception-enhancing reading support. Translation is outside this product's scope. Each explicit action queues one durable Harness user message with the exact snapshot it displayed, creating a session on first use and reusing it for later prompts. The Lens subscribes on a dedicated pipe, renders correlated answer text, tracks the host turn terminal state, preserves shared-turn request identities, and offers safe recovery when a submit reply is unknown. See [session integration](docs/session-integration.md), [session-bound selection tools](docs/session-tools.md), and [Selection Lens](docs/selection-lens.md) for the current limits.

Session checks:

```powershell
pnpm test:session
pnpm test:session:replay
pnpm test:session:e2e
```

`test:session:e2e` deliberately returns exit code 2 until an isolated `dsh` profile, configured model provider, and Windows named-pipe evidence are supplied.

`pnpm test:bridge:integration` exercises the production Node transport and compiled Rust probe over a unique Windows Named Pipe. It sends 100 ordered events while ping and submit run on the request pipe, then verifies clients and listeners return to zero. It exits 2 on non-Windows systems. The bridge has bounded request exchanges and client admission; see [bridge transport limits](docs/bridge-transport.md) for its retry and access-control limits.

Rust formatting:

```powershell
cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check
```

### Optional extension checks

The DOM extension is tested separately and is no longer part of `check:task5`:

```powershell
pnpm check:browser-extension
```

Optional real Chromium DOM fixture:

```powershell
pnpm --dir browser-extension exec playwright install chromium
pnpm check:browser-extension:e2e
```

## Manual Task 5 extensionless integration test

### 1. Pull and validate

```powershell
git pull origin main
pnpm install
pnpm check:task5
```

No extension build or Native Messaging registration is required.

### 2. Install / start the Harness bundle

If the development bundle needs reinstalling:

```powershell
pnpm pack
dsh plugin --profile web remove dsh-selection-companion
dsh plugin --profile web add .\dsh-selection-companion-0.1.0.tgz
```

Start Harness in Terminal A:

```powershell
dsh web
```

Expected logs include:

```text
[selection-companion] plugin loaded!
selection companion native bridge listening on \\.\pipe\dsh-selection-companion-v3
```

### 3. Start Native Companion

Terminal B:

```powershell
pnpm native:dev
```

The Tauri process now owns both:

```text
Task 4 Harness bridge client
Task 5 UIA selection capture runtime
```

### 4. Select text in an ordinary browser

Open an ordinary HTTP/HTTPS page in Chrome or Edge.

Do **not** install the project extension.

Select a non-empty piece of page text using the mouse or keyboard. Task 5 capture is silent; the near-selection Lens belongs to Task 6.

Expected path:

```text
browser text selection
 → UIA Text_TextSelectionChanged
 → BrowserAccessibilityProvider
 → SelectionSnapshot
 → Windows Named Pipe
 → selection.update
 → ctx.selectionContext
```

No clipboard writes and no synthetic Ctrl+C / Ctrl+V are used.

### 5. Verify Harness received it

While `dsh web` and `pnpm native:dev` remain running:

```powershell
pnpm debug:selection
```

Expected output contains the selected browser text and:

```json
{
  "provider": "browser-accessibility"
}
```

Useful fields to inspect:

```text
selection.text
source.kind
source.app
document.title
document.url
document.section
context.before
context.after
context.sectionText
geometry
confidence
```

Some browser versions/pages may expose less accessibility metadata. Missing optional URL/heading/context fields must reduce capabilities/confidence rather than invalidate an otherwise valid selected-text snapshot.

## Task 5 acceptance criteria

The extensionless Task 5 golden path is accepted when:

1. `pnpm check:task5` passes on Windows.
2. `cargo fmt --check` passes.
3. Chrome/Edge has no project extension installed or enabled.
4. `dsh web` and `pnpm native:dev` start normally.
5. selecting text automatically causes `pnpm debug:selection` to return the same text from Harness state.
6. the returned snapshot uses `provider = browser-accessibility`.
7. no localhost HTTP bridge is opened.
8. no clipboard mutation or synthetic copy/paste occurs.
9. repeated UIA events for one selection do not create an uncontrolled burst of snapshots.

The optional Browser DOM extension has its own separate checks and is not a Task 5 acceptance dependency.

## Still not implemented

- exact TextRange bounding rectangles for the Lens
- MouseUp fallback for browser builds that do not reliably raise UIA selection-change events
- generic Windows UIA provider for arbitrary desktop applications
- Word COM provider
- lazy full-page context expansion
- a real supported `dsh` profile/model run that invokes and records `selection_current` / `selection_read_context`
- Lens approval / ask-user interaction
- complete-Harness navigation from the Lens into the same session
- real-model session e2e runner and visible Tauri interaction evidence

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

Native providers only feed a capability owned by the installed Harness plugin. They do not bypass Harness Session, Agent, tool, or durable-log architecture.

## License

MIT
