# Session-bound selection material

## Decision

Protocol V3 requires every `session.submit` to contain a validated `material` object. The object is a deliberately small projection of the frozen browser snapshot: snapshot and revision identities, capture time, selected text and language, source, optional document identity, and literal `authorizedScope`, `actualScope`, and `completeness` values of `selection`, `selection`, and `complete`.

The session service saves that object in the durable `selection-companion` source of the submitted user message. Its request fingerprint includes the material. Native retry reuses the frozen material that accompanied the first attempt rather than reading the current browser selection again.

`selection_current` and `selection_read_context` are registered through the Harness Agent `setup` hook and resolve data from the executing tool call id, its durable turn, and the latest preceding companion user message in that turn. They never read a process-global current selection, Native IPC state, a last-submitted cache, or an assembled prompt. The only permitted read scope is `selection`.

Rust optional material fields may arrive as JSON `null`. The TypeScript parser converts those wire-level nulls to omission and removes undefined object keys before material becomes a durable JSON value. This preserves a single V3 wire format without permitting invalid durable JSON.

## Affected behavior

An accepted request continues to refer to the exact user-visible material that was submitted, even after another selection, a retry, Agent resume, or session-service reconstruction. Scoped tools can return only that request's material and carry source, scope, and completeness presentation metadata. A missing or ambiguous durable relationship fails visibly instead of silently reading another request's material.

V2 peers cannot attach to the V3 pipe. The versioned pipe name prevents a mixed installed Native/Harness pair from silently changing the meaning of `session.submit`.

## Alternatives considered

Keeping Protocol V2 with optional material would let a peer submit a request that has no reconstructable selection fact. Reusing a global capture cache or deriving material from the prompt would make newer selections, another session, and prompt formatting influence a tool result. Saving surrounding context by default would exceed the user's explicit selection authorization. These alternatives were rejected.

## Consequences and limits

Selection text is now intentionally durable Harness session data for every accepted V3 submission. Product surfaces must treat it as sensitive reference material and avoid exposing it in diagnostics, screenshots, or unrelated sessions.

The implementation does not expand local, section, or page context; that is R08.1 work requiring explicit user authorization. It does not prove a supported `dsh` profile, real model, visible Tauri window, actual host-policy flow, or process-directory restart. R07 owns those product-path checks.

## Verification evidence

Commit `5ec3a8a` passed focused TypeScript, session replay, real ToolRuntime/Agent scope, Lens, protocol/Rust contract, Windows Named Pipe, bundle, build, and Rust-format checks. The exact commands, results, and evidence limits are recorded in [R04 session-bound selection tools](../evidence/r04-session-bound-selection-tools.md).
