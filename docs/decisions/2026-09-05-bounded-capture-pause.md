# Bounded capture and process-local pause

## Decision

Keep one unpublished native selection and replace it with the newest capture during a burst. Make pause a process-local CaptureRuntime state that clears that pending value and is independent of bridge connection state.

## Consequences

The runtime cannot grow a queue while Harness is slow or disconnected, and reconnecting cannot silently resume user-paused capture. An already published immutable snapshot remains owned by Harness because Protocol V1 does not define a clear lifecycle message. The companion reports capture state and aggregate counters without logging selected text or URLs. Startup configuration supplies timing, local context limits, and exact source exclusions.

## Alternatives

An unbounded channel would preserve every event but can retain stale material and consume memory during a disconnected bridge. Persisting pause immediately would introduce user settings ownership and migration requirements before that seam exists. Clearing the Harness cache from a local focus change would violate the distinction between ambient capture and material already fixed for a user action.

## Verification and limits

`pnpm test:capture` covers mailbox capacity, pause clearing, deduplication, and exclusion matching. `pnpm test:native-ui` covers the pause control. Interactive Chrome/Edge UIA evidence remains required; private-browser detection is not claimed.
