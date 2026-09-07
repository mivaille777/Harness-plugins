# Session-bound selection tools

T05-D requires a Harness tool capability that can register a tool for one Agent instance, route calls through the host approval flow, and append the tool result to that Agent's durable session log.
The published `@deepseek-ai/dsh-tools@0.1.1-rc.2` package exists, and the installed Agent declarations expose `setup(agentCtx)` for creation and resume, explicitly including scoped tool composition. The plugin does not yet declare or integrate the tool package. Its matching-version exports and profile assembly still require implementation verification.

The Selection Companion must not substitute a global current-selection callback, a prompt convention, or a native IPC read for this missing capability.
Those alternatives would let a later browser selection contaminate an earlier session and would bypass the host's tool approval and result logging.

The integration must verify and use the following host capabilities:

- An Agent creation or resume option accepting Agent-local tool definitions.
- A tool handler context containing the Agent's session id and a host approval operation.
- A durable, model-visible tool result event written by the host after approval.
- A disposer tied to the Agent lifecycle.

Once available, the plugin will bind an immutable selection snapshot to that Agent-local tool context and expose `selection_current` and `selection_read_context`.
Both handlers will read only the snapshot stored for that session. Rehydration must read the persisted selection material from the session log, so clearing native memory cannot change a replayed tool result.

The earlier conclusion that T05-D required a new upstream tool capability is withdrawn. Follow R04 of [the integration development plan](harness-integration-development-plan.md) to verify matching-version dependencies and implement scoped tools, durable request-bound material, policy integration, and recovery tests. Existing submission and Lens code do not complete this work.
