# EC-09 real Chromium and Tauri Lens run

Date: 2026-09-28  
Repository: `mivaille777/Harness-plugins`  
Branch: `test/ec09-local-tauri-e2e`

## Result

`pnpm test:ec09:tauri-lens` passed on Windows with a real Chromium process, the built Native Messaging host, the Harness named pipe, and the real Tauri application running in WebView2.

The controlled fixture selected its sentinel text in Chromium. The selection reached Harness, appeared in the Lens after opening the Passive Entry, and was used to load and explicitly authorize section context. The visible request material stayed bound to the same snapshot and revision after an unrelated newer global selection arrived. The request streamed through a local deterministic SSE model endpoint, and the completed user and assistant entries were observed in durable Harness Session history.

The validated report contained these states and assertions:

- States: `idle`, `authorized`, `material`, `streaming`, `history`.
- Assertions: `browser-selection-captured`, `expanded-context-loaded`, `expanded-scope-authorized`, `request-material-matches-authorization`, `session-transcript-observed`.
- Authorization: requested, authorized, actual, and submitted scope were all `section`; snapshot revision was `1`; the material remained frozen.
- Session evidence: source was `dsh-session`; transcript and authorized context were observed with the matching snapshot id and revision.

The screenshot report and five PNGs from the run were written under `%TEMP%\dsh-ec09-verify-20260928125312` on the test machine. The `idle` screenshot visibly shows the selected Chromium text in the Lens.

## Change made after the first run

The first real-window run found a missing bridge path: browser Native Messaging updated Harness, but the Tauri app did not receive a selection notification, and the Passive Entry did not read an already-current selection on startup. The bridge now sends identity-only `selection.event` notifications to Native clients that advertise the event-capable hello name. The Passive Entry also reads the current snapshot after registering its listener and ignores duplicate snapshot notifications. The driver waits for and opens the real Passive Entry before checking the Lens.

The browser test now writes its temporary Native Messaging manifest inside its isolated run directory. It does not overwrite the user's existing manifest under `%LOCALAPPDATA%`.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS |
| `pnpm --dir native build` | PASS |
| `pnpm exec vitest run tests/bridge-server.spec.ts tests/protocol.spec.ts` | PASS; 28 tests |
| `cargo build --locked --manifest-path native/src-tauri/Cargo.toml --bin dsh-selection-companion-native --bin dsh-selection-companion-host` | PASS |
| `pnpm test:ec09:tauri-lens` | PASS; real Chromium, Native Messaging, Harness, Tauri WebView2 and Session history |
| `git diff --check` | PASS |

## Limits

The browser selection is created by automation in a real Chromium fixture, rather than by a person dragging the mouse. The model endpoint is deterministic and local; this run proves delivery through Harness Session and history, not a live DeepSeek API response. This run exercises the browser extension provider, not the default UI Automation provider in Chrome or Edge. The native Windows folder picker itself was not opened during this run; its UI and `cwd` routing are covered by the workspace-selection checks recorded in `workspace-selection.md`.
