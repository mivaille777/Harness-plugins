# Bridge transport limits

The native companion applies `DSH_SELECTION_BRIDGE_TIMEOUT_MS` to the full write, flush, and reply-read exchange. Its default is 5000 ms and accepted values are integers from 1 through 60000. A timeout disconnects the native client and reports an error; it does not retry a `selection.update`, because the caller cannot know whether Harness processed a write that lost its reply.

The optional browser Native Messaging host uses the same five-second exchange limit. It may reconnect once only for its own selection or ping message and never represents a timed-out selection as known not to have reached Harness.

The Node named-pipe server has a 30000 ms idle timeout and admits at most four clients. Responses on each client are serialized by write completion, so a partial or slow peer cannot reorder its replies. The current V1 router is request/reply only; it does not claim to deliver `agent.event` streaming messages. A later session task must add a single reader and request/event dispatcher before advertising that capability.

Node's built-in named-pipe server API does not provide a supported way to declare a Windows ACL on an individual pipe. This repository therefore does not claim authenticated or same-user-only pipe access. Do not expose the default pipe name across trust boundaries. A release that needs that isolation must add and test a maintained Windows security-descriptor implementation.

## Verification

~~~powershell
pnpm test:bridge
pnpm test:protocol
pnpm test:rust
~~~

`pnpm test:bridge:integration` is a non-pass guard for the future real Node/Rust named-pipe test. It must remain unverified until it exercises partial frames, timeout cleanup, reconnect, and two clients on an interactive Windows host.
