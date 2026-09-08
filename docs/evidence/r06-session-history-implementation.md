# R06 session-history implementation evidence

Date: 2026-09-08

Repository and branch: `mivaille777/Harness-plugins`, `feat/t05-session-integration`

Harness dependency line: `@deepseek-ai/dsh-session-query`, `@deepseek-ai/dsh-session`, and `@deepseek-ai/dsh-agent` `0.1.1-rc.2`

## Delivered behavior

The plugin projects append-origin `user/message` and `assistant/message` events from `sessionQuery.readSession()` into detached human-visible history entries. Streaming chunks, tool results, reasoning blocks, replacements, and empty text do not create duplicate transcript entries. The projection preserves durable sequence and time plus source kind and Selection Companion request identity when available.

The bridge exposes `session.history` as a bounded page request. A page contains at most the configured 32 visible entries and returns `capturedThroughCursor`, the raw durable high-water mark captured with that read, plus `nextCursor` only when more visible entries remain. Native follows pages before subscribing from the captured high-water cursor, so hidden log events do not cause a missed live event and large histories do not require one unbounded IPC response.

Native list/create/history commands use the request/reply pipe. Each live session subscription keeps its own pipe and is tracked as an opening or active slot with a session id, subscription id, and generation. Switching or unmounting removes the exact slot, cancels an opening connection, aborts an active reader, and waits outside the state mutex. A stale reader cannot remove a newer subscription.

Lens loads session summaries, opens the first available session, renders durable history, creates a new session, switches sessions, restores history after a read, and reports restoration failure without silently creating a replacement. Live history entries merge by durable sequence; request output remains filtered by session, request, and subscription identity.

## Automated and integration evidence

| Evidence | Command | Result |
|---|---|---|
| TypeScript source and tests | `pnpm typecheck` | PASS, exit 0 |
| Full plugin unit suite | `pnpm test` | PASS, 9 files and 69 tests |
| Shared TypeScript/Rust protocol fixtures | `pnpm test:protocol` | PASS, 13 tests |
| Durable projection, service paging, transport | `pnpm test:session:history` | PASS, 25 tests |
| Bridge routing | `pnpm test:bridge` | PASS, 9 tests |
| Durable replay | `pnpm test:session:replay` | PASS, 3 tests |
| Native Lens, history merge, and bridge API | `pnpm test:lens:session` | PASS, 33 tests |
| Native frontend production build | `pnpm --dir native build` | PASS |
| Rust protocol and bridge tests | `pnpm test:rust` | PASS, 25 tests |
| Windows Node/Rust named-pipe probe | `pnpm test:bridge:integration` | PASS; 100 ordered events plus ping, list, create, history, submit, and zero remaining clients/listeners |
| Root TypeScript build | `pnpm build` | PASS |
| Bundle composition | `pnpm verify:bundle` | PASS |
| Rust formatting | `cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check` | PASS |
| Patch hygiene | `git diff --check` | PASS |

## Evidence limits

The checks prove plugin-side history ownership, page/cursor semantics, Native command serialization, exact subscription cleanup, and the Windows Node/Rust pipe path. They do not prove a supported `dsh` profile, a real model response, host-owned approval or ask-user behavior, a visible Tauri window, browser capture, process restart against a real session directory, or a screenshot. Those checks remain R05/H05 and R07 responsibilities.
