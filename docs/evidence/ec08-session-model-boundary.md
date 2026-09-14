# EC-08 — Session → Agent → Model Boundary

## Goal

EC-07 proves two adjacent boundaries independently:

- durable Session restart/replay keeps the original authorized material bound to the request;
- a real DSH CLI task forwards a known prompt to an actual OpenAI-compatible model request.

EC-08 closes the gap between them. It requires the model request to originate from a **Protocol V4 `session.submit`** handled by Selection Companion, not from the DSH CLI prompt itself.

Target chain:

```text
Protocol V4 named pipe
  -> session.create
  -> session.submit(content + canonical SelectionMaterial)
  -> durable selection-companion user message
  -> Harness Agent followup
  -> OpenAI-compatible model request
```

## Contamination guard

The runner deliberately installs unrelated current selection state before creating the Session:

```text
selection.update
  snapshot text/context = EC08_GLOBAL_CURRENT_MUST_NOT_LEAK_16180
```

It then submits a separately frozen page-authorized material containing only:

- selection sentinel: `EC08_SESSION_SELECTED_TOKEN_27182`;
- page sentinel: `EC08_SESSION_PAGE_CONTEXT_31415`.

The actual model request must contain both authorized sentinels and must **not** contain the global/current-selection sentinel.

This turns the global selection cache into an active negative control. A model request contaminated by `selection.current`, a late context expansion, or other live selection state fails EC-08.

## Why a bootstrap request is held open

The DSH CLI normally exits after its own task completes. EC-08 needs the same DSH process to keep the Selection Companion plugin and Windows named-pipe server alive while an independent Session is created through the pipe.

`scripts/ec08-session-model-boundary.mjs` therefore starts a local deterministic OpenAI-compatible SSE server and holds the CLI bootstrap model request open. While that request is pending, the runner:

1. connects to an isolated Selection Companion pipe;
2. negotiates Protocol V4 with `bridge.hello`;
3. installs the unrelated global snapshot with `selection.update`;
4. calls `session.create`;
5. calls `session.submit` with the fixed page-authorized material and canonical-equivalent prompt;
6. waits for a later model request carrying the Session sentinels;
7. verifies the same request identity/material in `session.history` before releasing the bootstrap turn.

Once that target request is observed, the local server returns `EC08_SESSION_MODEL_OK` and releases the bootstrap request.

## Privacy-safe evidence

The local model boundary does not persist full model messages. It records only:

- request method/path;
- selected model name;
- message count;
- expected-sentinel booleans;
- forbidden-sentinel booleans;
- SHA-256 of serialized model messages.

The final report is `ec08-session-model-boundary.json` under `EC08_ARTIFACT_ROOT` or the default R07 report directory.

## Deterministic helper tests

`scripts/test-ec08-session-model-boundary.mjs` verifies:

- authorized material/prompt contain the two expected sentinels;
- authorized material/prompt do not contain the global contamination sentinel;
- the global snapshot does contain the contamination sentinel;
- 4-byte big-endian V4 framing survives arbitrary chunk boundaries;
- request matching fails if either authorized sentinel is absent or the global sentinel leaks;
- the model probe retains only safe observations and hashes, never the full message list.

Run the deterministic chain through EC-08 with:

```powershell
pnpm check:ec08
```

## Actual Session → model probe

On Windows:

```powershell
pnpm test:ec08:session-model-boundary
```

A PASS requires all of the following:

- Protocol V4 bridge negotiation succeeds;
- the unrelated global snapshot is accepted;
- `session.create` returns a Session id;
- `session.submit` is accepted;
- the plugin is loaded in the DSH process;
- durable Session files exist;
- `session.history` observes the submitted request/material;
- an actual local model HTTP request contains both authorized sentinels;
- that same request excludes `EC08_GLOBAL_CURRENT_MUST_NOT_LEAK_16180`.

Missing Windows/DSH prerequisites are reported as `NOT RUN`; they must never be converted into a false PASS.

## Real Windows CI evidence — PASS

EC-08 REAL passed on GitHub Actions Windows in workflow run `34842145461`, job **EC-08 real boundary**, for plugin commit `eee0db21be5177d6ad9879446f1fb4a84480fce8`.

The validation intentionally pins the official DeepSeek Harness `0.1.1-rc.2` release commit:

```text
b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
```

This is the Harness release family declared by the plugin's peer/dev dependencies. The CI job installs and builds that Harness source before running the real boundary test.

The uploaded privacy-safe report recorded:

```text
status = PASS
platform = win32
node = v24.11.1
pnpm = 11.7.0
dsh = 0.1.1-rc.2
pluginLoaded = true
bridge.bootstrapHeld = true
bridge.hello = true
bridge.globalSnapshotInstalled = true
bridge.sessionCreated = true
bridge.submitted = true
bridge.historyVerified = true
durableSessionFileCount = 2
```

The model probe observed three HTTP chat-completion requests. The Session-originated request had:

```text
EC08_SESSION_SELECTED_TOKEN_27182 = true
EC08_SESSION_PAGE_CONTEXT_31415 = true
EC08_GLOBAL_CURRENT_MUST_NOT_LEAK_16180 = false
```

Its model-message payload was retained only as SHA-256:

```text
3ec8bbbdb83cca500c1856aa348a727643279cad398c498716bf47396ba85029
```

The durable history check saw 5 entries through cursor 20 for the target Session request.

Therefore EC-08 establishes, with an actual Windows Harness process and actual model HTTP request boundary, that the Session/Agent consumes the explicitly submitted canonical authorized material rather than re-reading unrelated global/current selection state.

## Scope boundary

EC-08 does **not** claim a real Chrome/Edge + visible Tauri interaction. That remains EC-09/L3. EC-08 proves the internal Session-to-model boundary after a canonical V4 submission; EC-09 is responsible for proving that a real user can create that submission from the browser/Lens workflow.

## Verification status

**PASS — real Windows Session → Agent → model boundary verified.**

The remaining core functional gate is EC-09 REAL: real Chrome/Edge selection → browser/native transport → visible Tauri Lens → explicit expanded-context authorization → matching Session request/history.
