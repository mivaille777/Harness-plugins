# R05 requires host-owned durable interactions

## Decision

Harness-plugins will not implement Lens approval or ask-user handling against the `0.1.1-rc.2` runtime with a companion-owned pending table, a second user-question provider, prompt parsing, automatically assigned interaction ids, or auto-approval. R05 first requires the host capability defined in [H05 durable session interactions](../host-tasks/r05-durable-session-interactions.md).

## Affected behavior

The current plugin can continue to submit selection-bound material and project existing session events, but it cannot claim that Lens can answer a pending approval or ask-user request. A current-process approval listener would be unable to resume after a disconnect or restart and cannot safely coexist with another UI, so it is not a product path.

## Alternatives considered

`ctx.approval.request()` records an `approval/asked`/`approval/decided` audit pair, but its public request has no stable answerable id or query/response API. The rc.2 user-question service accepts exactly one provider and has no durable pending state. Using either as a plugin-side interaction store would make UI state, rather than the Harness session log, authoritative. These approaches are rejected.

## Consequences and limits

R05 plugin code remains intentionally absent until a released, profile-composed host API provides session-owned interaction records and atomic response semantics. R06 read-only session-history work may still proceed where its API audit permits it. R07 cannot claim a complete approval or ask-user path before both H05 and plugin R05 are complete.

## Verification evidence

The release-package audit and exact observed API limitations are recorded in [R05 host API audit](../evidence/r05-host-api-audit.md). The host task contains the required failing tests, implementation phases, and commands.
