# P1-1 Session Adapter API Audit

Date: 2026-09-27

Repository: `mivaille777/Harness-plugins`

## Harness API verified

Inspected the local Harness source checkout at `D:\deepseekHarness\deepseek-harness-git`, HEAD `76fda72979`. The checkout has unrelated uncommitted work; the inspected Agent, Session, SessionQuery, and headless composition files are clean in that worktree.

| Need | Harness API and matching adapter path |
|---|---|
| Create / resume a Session-backed Agent | `ctx.agents.create(options)` and `ctx.agents.resume(options)` return an `AgentHandle`; `SelectionCompanionSessionService.create()` and `resolveAgent()` use these. |
| Queue / steer a prompt | `Agent.followup(UserMessage)` queues an ordinary next-turn prompt; `Agent.steer(UserMessage)` submits next-step input. The adapter maps `queue` and `steer` to these methods. |
| Cancel | `Agent.cancel(cause)` is the supported cancellation entry; the adapter calls `cancel({ kind: 'user' })`. |
| Subscribe to durable Agent events | `ctx.on('session/event', (session, event))` supplies typed `SessionEvent` records with monotonically increasing `seq`; the adapter projects them and preserves the durable cursor. |
| Read durable sessions and history | `ctx.sessionQuery.listSessions()`, `readSession(SessionId)`, and `readTitleSnapshots()` are the actual read APIs used by the adapter. `readSession()` replay-validates the complete raw event log without making a session live. |
| Persist logs in the shipped headless profile | The Harness base profile composes `@deepseek-ai/dsh-session-persistence-jsonl` under `$DSH_HOME/sessions` and `@deepseek-ai/dsh-session-query-sqlite` with `openAt: never`; exact history reads remain available without opening content search. |

The released interaction surface was separately audited in [R05 Host API audit](r05-host-api-audit.md): `ctx.approval.request(...)` exists, but the released API does not provide a durable, multi-client Lens decision channel. The local Host checkout has newer interaction work in an uncommitted branch; this adapter does not depend on it. P1-4 must use a committed and consumable Host API before adding Lens approval controls.

## Adapter behavior and verification

The existing adapter writes Lens input as a normal Harness `UserMessage` with `source.kind: 'selection-companion'`, the logical request ID, delivery mode, digest, and the authorized selection material. It has no separate chat transcript. Durable history is projected from `SessionQuery`; after the Agent service is recreated, the session is resumed by its existing ID.

| Command | Result |
|---|---|
| `pnpm exec vitest run tests/session-service.spec.ts tests/session-history.spec.ts tests/session-replay.spec.ts tests/session-transport.spec.ts tests/bridge-server.spec.ts tests/ec05-session-persistence.spec.ts tests/ec07-session-restart.spec.ts` | PASS; 7 files, 42 tests |
| `pnpm test:bridge:integration` | PASS; 100 ordered events plus expansion, ping, list, create, history, and submit; zero remaining pipe clients/listeners |
| `pnpm typecheck` | PASS |
| Existing [R07 layered runner evidence](r07-session-e2e.md) | L1 PASS against the then-selected Harness source checkout; a non-empty durable session log was observed |

## Evidence limits

- The current P0-6 candidate was not rerun through a full supported `dsh` profile or a real model. The R07 L1 profile run is earlier evidence and is linked above.
- The installed plugin peer range is `0.1.1-rc.2`; the inspected local Harness source packages report `0.1.2-rc.1`. The method contracts match, but no package-version upgrade is included in this audit.
- No independent Lens history file exists; the displayed transcript is projected from Harness session events.
