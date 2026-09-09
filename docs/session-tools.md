# Session-bound selection tools

The companion declares `@deepseek-ai/dsh-tools@0.1.1-rc.2` as a peer and uses the matching runtime's Agent `setup(agentCtx)` hook on both create and resume. The setup function registers the two tools through the Agent-scoped `ToolRuntime`; it does not create a process-global selection registry.

The durable-binding rule is recorded in [the selection-material decision](decisions/2026-09-08-session-bound-selection-material.md).

## Fixed request material

Every Protocol V3 `session.submit` carries a validated `material` object, and the Harness service saves that object in the durable `selection-companion` source of the ordinary user message. The object contains the snapshot identity and revision, capture time, selected text, source, optional document identity, and literal `authorizedScope`, `actualScope`, and `completeness` values of `selection`, `selection`, and `complete`.

This is intentionally smaller than a capture snapshot. It does not include local, section, or page context, geometry, provider information, confidence, or capabilities. Native retry retains the exact Lens snapshot used for the first attempt. Clearing native capture memory or receiving a newer browser selection therefore cannot change the durable request material.

## Available tools

`selection_current` has no parameters. It returns the request and snapshot identities, capture time, source and document metadata, selected-character count, language when present, and the authorization/completeness fields. It does not return the selected text.

`selection_read_context` requires `scope: "selection"`. It returns the same metadata and the exact persisted selected text. Its rendered result labels that text as untrusted reference data, not instructions. The parameter cannot request `local`, `section`, or `page`, and the implementation does not expand, refetch, or infer surrounding page content. The separate bridge `selection.expand` operation serves the Lens reference preview only; it is explicitly user-triggered, bounded, revision-bound, and excluded from durable session material and model input.

Both tools use generic read call/result presentation with source, scope, and completeness metadata. They check the host cancellation signal before resolving material. They add no companion-owned approval decision, permission store, or Lens approval UI; those interactions remain R05 work and must use a verified Harness host flow.

## Resolution and isolation

At execution, a tool verifies that the execution Agent is the Agent whose setup registered it. It locates its unique durable `tool/call`, reads the associated turn, and selects the latest preceding `selection-companion` user message in that same turn. It validates the saved material again before returning it. A missing call, duplicate call ID, missing material, or cross-Agent execution fails visibly.

This lookup deliberately does not read `ctx.selectionContext`, Native IPC, a last-submitted cache, or the assembled prompt. It is valid after Agent resume because the source message belongs to the durable session log. Tool registrations belong to the Agent setup scope and must disappear when that scope is disposed.

## Acceptance status and verification

R04 automated behavior, cross-language checks, and the Windows Node/Rust named-pipe integration test passed for commit `5ec3a8a`; see [R04 evidence](evidence/r04-session-bound-selection-tools.md). A supported `dsh` profile/model invocation, host-policy behavior, durable tool-result observation, visible native interaction, and screenshot have not been recorded. Do not treat unit, fixture, or WebView results as evidence of those real paths.

Run the focused checks from the plugin repository root after changing this surface:

~~~powershell
pnpm typecheck
pnpm test:protocol
pnpm test:session
pnpm test:session:replay
pnpm test:session:tools
pnpm test:lens:session
pnpm --dir native build
pnpm test:contract
pnpm test:bridge:integration
pnpm verify:bundle
~~~

`test:bridge:integration` is Windows-only. The last required R04 check is a real supported profile that exposes both tool names, invokes each tool for a submitted selection, verifies that another session and a newer capture cannot alter the result, and inspects the host's durable tool events. See R04 of [the integration development plan](harness-integration-development-plan.md) for the full acceptance matrix.
