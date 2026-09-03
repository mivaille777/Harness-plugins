# dsh-selection-companion

Windows Selection Context Bridge for DeepSeek Harness.

> Select anywhere → Continue in DeepSeek.

This repository is currently at **Task 1** of the implementation plan: it is a minimal, installable DeepSeek Harness bundle. Selection capture, native overlay, session bridging, and Agent tools will be added in later tasks.

## What Task 1 provides

- A standard Cordis plugin entry (`src/index.ts`)
- A DeepSeek Harness bundle manifest via `package.json#dsh.bundle`
- A bundle layer in `cordis.patch.yml`
- TypeScript build and type checking
- A Vitest smoke test for the plugin entry
- A bundle verifier that checks manifest, patch, and build artifacts
- `prepare` support so future Git installs can build from source

DeepSeek Harness installs third-party plugins as **bundles** into a named **profile**. This package follows that mechanism; it does not use the removed legacy `.dsh-plugin` repository-plugin path.

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.x`
- A working `dsh` CLI installation

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

Expected smoke-test output includes:

```text
[selection-companion] plugin loaded!
```

## Manual DeepSeek Harness installation test

Build and pack the plugin first:

```powershell
pnpm install
pnpm check
pnpm pack
```

This should create a tarball similar to:

```text
dsh-selection-companion-0.1.0.tgz
```

Use a clean Harness home so the test does not affect your normal profiles:

```powershell
$env:DSH_HOME="$PWD\.test-dsh-home"
Remove-Item -Recurse -Force $env:DSH_HOME -ErrorAction SilentlyContinue
```

Install the tarball into the Web profile:

```powershell
dsh plugin --profile web add .\dsh-selection-companion-0.1.0.tgz
```

Verify that Harness composed the bundle layer:

```powershell
dsh --profile web --dump-config | Select-String "selection-companion"
```

The output must contain the `selection-companion` row contributed by this package.

Start Harness:

```powershell
dsh web
```

During startup, the terminal must print:

```text
[selection-companion] plugin loaded!
```

Finally, verify clean removal:

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

This is the compatibility boundary we will preserve as the plugin grows: Windows/native functionality will be exposed through the Harness plugin rather than bypassing Harness session or capability APIs.

## Scope

Task 1 intentionally does **not** implement:

- Windows selection capture
- Browser extension
- Native overlay
- Session prompt/follow bridge
- `selection_current` or `selection_read_context` tools

Those belong to later milestones after the installable Harness bundle foundation is verified.

## License

MIT
