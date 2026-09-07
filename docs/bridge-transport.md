# Bridge transport limits

The native companion applies `DSH_SELECTION_BRIDGE_TIMEOUT_MS` to the full write, flush, and reply-read exchange. Its default is 5000 ms and accepted values are integers from 1 through 60000. A timeout disconnects the native client and reports an error; it does not retry a `selection.update`, because the caller cannot know whether Harness processed a write that lost its reply.

The optional browser Native Messaging host uses the same five-second exchange limit. It may reconnect once only for its own selection or ping message and never represents a timed-out selection as known not to have reached Harness.

The Node named-pipe server applies a 30000 ms idle timeout during request setup and admits at most four clients. An acknowledged session subscription disables that request idle timer because a model may legitimately remain silent for longer. Responses and events on each client are serialized by write completion. The pending write budget defaults to 4 MiB; exceeding it closes the stream explicitly so the client can resume from its last accepted durable cursor rather than lose events silently.

Session events use a dedicated pipe and one reader. `session.subscribed` is written before buffered replay events. Its `subscriptionId` equals the subscribe envelope id and is repeated on every `agent.event`, allowing the native client to reject events from a replaced reader. Closing a socket disposes all subscriptions, including a subscription whose asynchronous setup returns after close.

Node's built-in named-pipe server API does not provide a supported way to declare a Windows ACL on an individual pipe. This repository therefore does not claim authenticated or same-user-only pipe access. Do not expose the default pipe name across trust boundaries. A release that needs that isolation must add and test a maintained Windows security-descriptor implementation.

## Verification

~~~powershell
pnpm test:bridge
pnpm test:protocol
pnpm test:rust
pnpm test:bridge:integration
~~~

On Windows, `pnpm test:bridge:integration` builds the plugin, starts the real Node named-pipe transport on a unique endpoint, and runs a Rust client probe. It verifies subscription acknowledgement before 100 ordered events, concurrent ping and submit on a separate request pipe, and zero remaining clients/listeners. The TCP test remains the faster failure-path suite; it does not substitute for this Windows evidence.
