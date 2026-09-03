# dsh-selection-companion

Windows Selection Context Bridge for DeepSeek Harness.

> Select anywhere → Continue in DeepSeek.

The repository has completed **Task 2** of the implementation plan. It is an installable DeepSeek Harness bundle and now exposes a real Cordis capability, `ctx.selectionContext`, for immutable ambient selection snapshots. Native capture, IPC, overlay UI, Session bridging, and Agent tools remain later milestones.

## What is implemented

### Task 1 — installable Harness bundle

- Standard Cordis plugin entry (`src/index.ts`)
- DeepSeek Harness bundle manifest via `package.json#dsh.bundle`
- Bundle layer in `cordis.patch.yml`
- TypeScript build and type checking
- Bundle verification and `prepare` support

DeepSeek Harness installs third-party plugins as bundles into a named profile. This package follows that mechanism and does not use the removed legacy `.dsh-plugin` repository-plugin path.

### Task 2 — Selection Context domain capability

- `SelectionSnapshot` domain model for browser/PDF/Word/desktop sources
- Source/document/local-context/capability/geometry metadata
- Runtime validation before a snapshot enters Harness state
- Detached, deeply frozen snapshots so consumers cannot mutate captured context
- In-memory TTL cache; expiry starts when Harness receives a snapshot rather than trusting an external process clock
- Strict per-snapshot revision ordering: equal or older revisions are rejected
- Bounded snapshot retention with oldest-entry eviction
- `SelectionContextService`, registered as `ctx.selectionContext`
- `current()`, `get()`, `update()`, `clear()`, `purgeExpired()`, and `size`

The service is the capability seam that future IPC, Agent tools, and Session integration will consume. Those consumers should not talk directly to a Windows/browser provider.

## SelectionSnapshot shape

```ts
interface SelectionSnapshot {
  id: string
  revision: number
  capturedAt: number
  selection: { text: string; language?: string }
  source: {
    kind: 'browser' | 'pdf' | 'word' | 'desktop'
    app?: string
    process?: string
    windowTitle?: string
  }
  document?: {
    title?: string
    url?: string
    filePath?: string
    section?: string
    frameUrl?: string
  }
  context: {
    before?: string
    after?: string
    sectionText?: string
    pageAvailable: boolean
  }
  capabilities: {
    localContext: boolean
    sectionContext: boolean
    pageContext: boolean
    screenshot: boolean
  }
  geometry?: {
    monitorId?: string
    x: number
    y: number
    width: number
    height: number
  }
  provider: string
  confidence: number
}
```

## Core Task 2 invariants

1. Whitespace-only selections are rejected, but the exact selected text is otherwise preserved.
2. A stored snapshot is detached and deeply frozen.
3. For the same `id`, only a strictly higher `revision` can replace the cached version.
4. A new selection becomes `current` without mutating previously captured snapshots.
5. TTL is based on Harness ingestion time, not `capturedAt`, to avoid cross-process clock skew.
6. The cache is memory-only and bounded. Persistence is intentionally not part of Task 2.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.x`
- A working `dsh` CLI installation for ecosystem installation tests

## Development checks

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm verify:bundle
```

Or run the complete gate:

```powershell
pnpm check
```

### Task 2 focused tests

```powershell
pnpm test:selection
```

This covers empty selections, Chinese/emoji, selections larger than 10k characters, deep immutability, revision ordering, TTL expiry, bounded eviction, and Cordis service registration.

### Manual Task 2 domain smoke test

```powershell
pnpm demo:selection
```

The command builds the package, creates a real Cordis `Context`, registers `SelectionContextService`, injects a browser-style fixture, and prints the snapshot returned by `service.current()`.

Expected output contains fields similar to:

```text
"id": "demo-selection-1"
"kind": "browser"
"provider": "demo-browser-provider"
```

No Windows capture or network bridge is involved yet; this command validates the Task 2 domain/service layer only.

## Manual DeepSeek Harness installation test

Build and pack the plugin:

```powershell
pnpm install
pnpm check
pnpm pack
```

Use a clean Harness home:

```powershell
$env:DSH_HOME="$PWD\.test-dsh-home"
Remove-Item -Recurse -Force $env:DSH_HOME -ErrorAction SilentlyContinue
```

Install into the Web profile:

```powershell
dsh plugin --profile web add .\dsh-selection-companion-0.1.0.tgz
```

Verify the bundle layer:

```powershell
dsh --profile web --dump-config | Select-String "selection-companion"
```

Start Harness:

```powershell
dsh web
```

During startup the terminal should print:

```text
[selection-companion] plugin loaded!
```

Remove it again with:

```powershell
dsh plugin --profile web remove dsh-selection-companion
dsh --profile web --dump-config | Select-String "selection-companion"
```

The final command should return no matching plugin row.

## Bundle contract

`package.json` declares:

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

The bundle patch inserts the package as a normal Cordis plugin:

```yaml
- insert:
    - id: selection-companion
      name: dsh-selection-companion
```

This compatibility boundary will remain stable as the project grows: Windows/native functionality will be exposed through Harness capabilities instead of bypassing Harness Session or Agent APIs.

## Not implemented yet

- Windows selection capture
- Browser extension
- Native IPC bridge
- Native overlay
- Session prompt/follow bridge
- `selection_current` / `selection_read_context` Agent tools
- Lazy section/page expansion providers

## License

MIT
