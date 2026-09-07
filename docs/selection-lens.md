# Selection Lens

The Lens reads `selection.current` through the native bridge and fixes the returned snapshot in its local view. Selecting new browser text does not replace that displayed material until the user chooses **Use latest selection**. The preview names its source and revision so a user can tell which material a session request will use.

Explain, Translate, and Ask send an explicit, fixed-material prompt to one Harness session. The Lens creates the session on its first action and reuses its returned id for later prompts. Selected webpage text is labelled as untrusted reference data. The Lens does not create another LLM client or conversation store.

The Lens projects only events carrying its active session and request ids. It displays `text-delta` content, excludes reasoning and tool-argument streams, and uses a complete assistant message to restore or calibrate one turn/step without duplicating streamed text. A complete assistant message ends a step rather than the request; the correlated `turn/end` reason determines completed, cancelled, limited, interrupted, blocked, or failed state. A session connection error remains visible even when the transport cannot provide a request id.

The request states are idle, submitting, queued, streaming, cancelling, completed, cancelled, error, connection-lost, and submission-unknown. Subscription starts only after the Tauri event listener is ready. A listener that resolves after the view closes is immediately released. Each subscription has a generated identity, resumes from the last accepted durable cursor while the Lens process remains active, and ignores replaced readers. An unknown submission locks new actions and offers an exact retry with the same logical request identity. Durable message facts let the Harness service recognize that retry after its in-memory receipt expires or the service restarts.

The Lens accepts output from a shared turn when its request id appears in `requestIds`; it does not invent one exclusive owner for a turn containing several queued or steered inputs. Once a request is completed, cancelled, or failed, later durable events may advance its cursor but cannot append text or change its terminal state. Tool approval, persisted Lens restoration after process restart, session/history navigation, and the real model workflow remain R04 through R07 in the [integration development plan](harness-integration-development-plan.md).

Enter submits a non-empty question, Shift+Enter inserts a line break, and Enter during an IME composition does nothing. Esc and the close button hide the Lens; they do not pause capture or cancel a future session request. Pause capture stays a separate footer action.

The current provider gives an enclosing accessibility-element rectangle, not an exact text-range rectangle. This task does not claim near-selection placement, focus restoration, DPI conversion, multiple-monitor placement, or a non-activating affordance. Those behaviors require a real Windows Tauri test and are not covered by WebView component tests.

~~~powershell
pnpm test:lens
pnpm test:lens:session
pnpm --dir native build
~~~

`pnpm test:lens:e2e` is intentionally non-passing until an interactive Windows Tauri test verifies focus, window location, DPI, and multi-monitor behavior.
