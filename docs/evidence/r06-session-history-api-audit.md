# R06 session-history API audit evidence

Date: 2026-09-08

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Audited runtime line: `@deepseek-ai/dsh-session-query`, `@deepseek-ai/dsh-session`, and `@deepseek-ai/dsh-agent` `0.1.1-rc.2`

## Available release APIs

`ctx.sessionQuery.listSessions(signal?)` merges live and persisted sessions in descending creation time. `readSession(SessionId)` returns a verified, detached complete durable event log without starting an Agent. `readTitleSnapshots(sessionIds, signal?)` supplies optional titles independently, while `readSurface()` is compacted model context and must not be treated as human-visible history. `isAppendSurfaceEvent()` is exported by `@deepseek-ai/dsh-session` and identifies durable events suitable for user/assistant history projection.

`ctx.agents.create({ sessionId, meta, agentOptions, setup? })` and `resume({ resumeSessionId, agentOptions?, setup? })` use the same session id. Resume can fail when persistence, logs, profile, provider, or model availability fail; the plugin must surface that failure instead of creating a replacement session.

## Existing plugin facts

`SelectionCompanionSessionService` already calls `listSessions()`, creates normal Harness Agents, resumes a cold Agent only when submitting, and subscribes by installing event listeners before it reads a durable session snapshot. The bridge server queues replay events until it writes `session.subscribed`; `tests/session-transport.spec.ts` covers that response-before-event order.

The current Native bridge has no list/create/history/unsubscribe commands. The React Lens maintains one `sessionId`, and `sessionProjection.ts` only shows the current request's output. It cannot render durable historical messages or safely dispose a prior session subscription during a quick switch.

## R06 scope established by the audit

R06 may independently add durable list/history projections, Native bridge commands, a Lens session selector, local restoration metadata, subscription disposal, and cursor-safe catch-up. It must not use `readSurface()` as history, scan session files, save a second answer-history database, or default to a new session after recovery failure.

There is no rc.2 Native Pipe API for opening the matching full Harness UI session. The plugin must not construct a guessed URL. A missing navigation capability is a visible, tested unavailable state until a supported host API is released.

R05 interaction history remains dependent on H05, but ordinary session list/history/recovery work does not wait for approval UI support.

## Required follow-up tests

```powershell
pnpm test:session:history
pnpm test:session
pnpm test:session:replay
pnpm test:session:transport
pnpm test:lens:session
pnpm test:protocol
pnpm test:contract
pnpm test:bridge:integration
pnpm typecheck
pnpm build
pnpm verify:bundle
```

The future `test:session:history` must cover live/persisted lists, missing/failed title reads, durable history plus catch-up consistency, two-session switching and late events, cold history reads without resume, one cold submit resume, cursor/reload/delete/corrupt-log/profile-model failures, session-isolated drafts/material/request state, subscription release, and the unavailable navigation state.

## Evidence limits

This is a release-type and source-path audit only. It does not run a real profile, model, Native window, browser capture, session-directory restart, or screenshot. It establishes the supported API surface and implementation boundary, not R06 completion.
