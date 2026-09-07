# Durable request identity and recovery

## Decision

Protocol V2 replaces V1 because `session.submitted` now requires a durable message receipt and agent events can carry shared-turn request identities. Native and Harness reject the other schema during handshake, and the default pipe name includes `v2` so mismatched installed processes cannot attach silently.

The companion assigns a logical request UUID before the first submit attempt. The logical identity is independent of transport envelope ids, Harness message ids, turns, steps, and subscription ids. A retry after an unknown response reuses the same session id, logical request id, delivery mode, and content.

The session service stores an in-flight Promise before resolving or resuming the Agent. Calls with the same request identity and fingerprint share that Promise. A conflicting session, content fingerprint, or delivery mode fails. The retention interval starts after Harness accepts the submission, so an unresolved Promise cannot expire and admit a second execution.

The durable user-message source stores the logical request id, delivery mode, and SHA-256 content fingerprint. After memory expiry or service restart, the service searches the Agent session events and returns the existing message receipt when those fields match. The receipt reports the Harness message id, accepted delivery operation, and whether it came from an existing durable fact.

One Harness turn may include several companion inputs. The event projection therefore retains an ordered set of request ids for each open turn. It emits an exclusive `requestId` only when exactly one request is known and emits `requestIds` for both exclusive and shared turns.

The native request pipe marks a submission as unknown when it cannot read or validate the response after writing the submit frame. It closes that pipe before offering recovery. The Lens locks other submit actions in this state and retries only the saved prompt and logical identity. Session cancellation remains a host session operation, and the Lens waits for the correlated turn fact before showing a terminal state.

## Consequences

Concurrent duplicate UI or IPC operations cannot create an extra Harness message while the first operation is unresolved. A restart can identify an accepted request from the session log without a companion-owned history database. A shared steer turn does not overwrite earlier request ownership.

Durable recovery depends on the Harness log containing the submitted message or inbox splice. When no durable fact exists after the bounded in-memory receipt expires, the service cannot claim prior acceptance. R07 must exercise the actual persistence and restart path before the project treats this behavior as real-model evidence.
