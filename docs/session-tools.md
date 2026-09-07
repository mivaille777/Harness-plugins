# Session-bound selection tools

T05-D requires a Harness tool capability that can register a tool for one Agent instance, route calls through the host approval flow, and append the tool result to that Agent's durable session log.
The installed `dsh` `0.1.1-rc.2` packages expose Agent, Session, SessionQuery, LLM, and default-model services, but do not expose a `dsh-tools` package or an Agent-scoped tool registration API.

The Selection Companion must not substitute a global current-selection callback, a prompt convention, or a native IPC read for this missing capability.
Those alternatives would let a later browser selection contaminate an earlier session and would bypass the host's tool approval and result logging.

The minimum upstream capability must provide the following:

- An Agent creation or resume option accepting Agent-local tool definitions.
- A tool handler context containing the Agent's session id and a host approval operation.
- A durable, model-visible tool result event written by the host after approval.
- A disposer tied to the Agent lifecycle.

Once available, the plugin will bind an immutable selection snapshot to that Agent-local tool context and expose `selection_current` and `selection_read_context`.
Both handlers will read only the snapshot stored for that session. Rehydration must read the persisted selection material from the session log, so clearing native memory cannot change a replayed tool result.

T05-D remains blocked on this explicit host capability. It is not represented as completed by the existing session submission, subscription, or Lens code.
