# R05 host API audit evidence

Date: 2026-09-08

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Audited runtime line: `@deepseek-ai/*` `0.1.1-rc.2`

## Observed release APIs

| Package | Observed capability | Missing R05 requirement |
|---|---|---|
| `@deepseek-ai/dsh-user-approval` | `ctx.approval.request({ agent, toolName, callId?, reason?, signal? })` returns `allowed-once`, `rejected`, `cancelled`, or `unavailable`; it logs one `approval/asked`/`approval/decided` audit pair | No public pending record query, stable response id in the answerer callback, response operation, claiming, multi-client arbitration, or restart recovery |
| `@deepseek-ai/dsh-user-questions` | One `registerProvider(provider)` and `ask({ questions, agent?, signal? })` | A second provider throws `DUPLICATE_PROVIDER`; no session event, interaction id, pending list, expiry, or recovery |
| `@deepseek-ai/dsh-tool-ask-user` | Forwards its tool call's live Agent and AbortSignal to `userQuestions.ask()` | Cannot make Lens coexist as a second provider or reconstruct a pending question |
| `@deepseek-ai/dsh-permission-presets` | Sets session-level sandbox/approval policy | No per-interaction pending or response state |

The plugin does not list those packages as direct peer/dev dependencies. The current local Harness source is `0.1.2-rc.1`, where user questions already use a different waterfall API; that source is not proof that the rc.2 plugin profile can import or compose it.

## Read-only probes

The following commands completed with exit 0 during the audit. The package tarballs and release `.d.ts`/`.js` files were inspected; no repository files were changed.

```powershell
pnpm view '@deepseek-ai/dsh-user-approval@0.1.1-rc.2' version peerDependencies exports --json
pnpm view '@deepseek-ai/dsh-user-questions@0.1.1-rc.2' version peerDependencies exports --json
pnpm view '@deepseek-ai/dsh-tool-ask-user@0.1.1-rc.2' version peerDependencies exports --json
pnpm view '@deepseek-ai/dsh-permission-presets@0.1.1-rc.2' version peerDependencies exports --json
npm pack '@deepseek-ai/dsh-user-approval@0.1.1-rc.2' --pack-destination $env:TEMP\dsh-r05-api-audit
npm pack '@deepseek-ai/dsh-user-questions@0.1.1-rc.2' --pack-destination $env:TEMP\dsh-r05-api-audit
npm pack '@deepseek-ai/dsh-tool-ask-user@0.1.1-rc.2' --pack-destination $env:TEMP\dsh-r05-api-audit
npm pack '@deepseek-ai/dsh-permission-presets@0.1.1-rc.2' --pack-destination $env:TEMP\dsh-r05-api-audit
```

## Decision and next work

The audit is an API-availability result, not an approval integration test. It establishes that the existing runtime cannot meet R05's durable, multi-client, recoverable interaction requirements without bypassing the host. [The decision record](../decisions/2026-09-08-r05-requires-host-owned-interactions.md) rejects that bypass. [H05](../host-tasks/r05-durable-session-interactions.md) is the required host work before the plugin can add `test:session:interaction`, IPC messages, or Lens decision UI.

## Evidence limits

No approval, ask-user, real model, supported profile, Tauri window, browser selection, or screenshot was run. The audit does not prove a future H05 implementation or a plugin integration; it only records the currently released API surface and the reason R05 cannot honestly proceed against it.
