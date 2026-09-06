# Selection Lens

The Lens reads `selection.current` through the native bridge and fixes the returned snapshot in its local view. Selecting new browser text does not replace that displayed material until the user chooses **Use latest selection**. The preview names its source and revision so a user can tell which material an eventual session request would use.

Explain, Translate, and Ask are visible product actions, but T05 has not connected them to a Harness session. Each action therefore states that no model request was sent. The Lens does not create another LLM client or conversation store.

Enter submits a non-empty question, Shift+Enter inserts a line break, and Enter during an IME composition does nothing. Esc and the close button hide the Lens; they do not pause capture or cancel a future session request. Pause capture stays a separate footer action.

The current provider gives an enclosing accessibility-element rectangle, not an exact text-range rectangle. This task does not claim near-selection placement, focus restoration, DPI conversion, multiple-monitor placement, or a non-activating affordance. Those behaviors require a real Windows Tauri test and are not covered by WebView component tests.

~~~powershell
pnpm test:lens
pnpm --dir native build
~~~

`pnpm test:lens:e2e` is intentionally non-passing until an interactive Windows Tauri test verifies focus, window location, DPI, and multi-monitor behavior.
