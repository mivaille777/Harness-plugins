# Durable session history paging and subscription ownership

Date: 2026-09-08

## Decision

Lens history is projected from append-origin durable session events returned by `sessionQuery.readSession()`. The current model surface is not a human transcript source because compaction and replacement can remove text the user already saw. A history response is bounded to 32 visible entries and carries the raw durable high-water cursor observed during the read. The next page uses the last returned visible sequence as an exclusive cursor; Native subscribes only after all pages finish and uses the captured high-water cursor.

List, create, and history requests share the serialized Native request/reply pipe. Each event subscription uses a dedicated pipe. The Native runtime records an opening or active slot keyed by session id and checks the subscription id plus generation before promoting, cleaning up, or removing a slot. Explicit unsubscribe aborts the reader and waits after releasing the mutex.

## Consequences

Hidden durable events do not make the Lens skip a later visible message. History reads do not resume a cold Agent, and the Native client does not keep a second answer database. The page count bounds ordinary large transcripts; an individual durable message still has to fit the existing one-megabyte IPC frame and is reported as a bridge error if it exceeds that transport limit.

## Alternatives considered

Reading `readSurface()` was rejected because compaction and replacement can omit text that was already visible. Returning the entire projected history in one response was rejected because it removes a predictable IPC bound. Starting a subscription before history loading was rejected because events could arrive between the read and the cursor decision; the captured high-water cursor makes the handoff explicit.

## Verification

The implementation is covered by `pnpm test:session:history`, `pnpm test:protocol`, `pnpm test:lens:session`, `pnpm test:rust`, `pnpm test:bridge:integration`, `pnpm build`, `pnpm verify:bundle`, and the Rust format check. Real profile, model, visible-window, restart, and human-factors evidence remains outside this decision.
