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
6. waits for a second model request carrying the Session sentinels.

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

On a Windows checkout with a usable `dsh` CLI/profile environment:

```powershell
pnpm test:ec08:session-model-boundary
```

A PASS requires all of the following:

- Protocol V4 bridge negotiation succeeds;
- the unrelated global snapshot is accepted;
- `session.create` returns a Session id;
- `session.submit` is accepted;
- the plugin is loaded in the DSH process;
- at least one durable Session file exists;
- an actual local model HTTP request contains both authorized sentinels;
- that same request excludes `EC08_GLOBAL_CURRENT_MUST_NOT_LEAK_16180`.

Missing Windows/DSH prerequisites are reported as `NOT RUN`; they must never be converted into a false PASS.

## Scope boundary

EC-08 does **not** claim a real Chrome/Edge + visible Tauri interaction. That remains EC-09/L3. EC-08 proves the internal Session-to-model boundary after a canonical V4 submission; EC-09 is responsible for proving that a real user can create that submission from the browser/Lens workflow.

## Verification status

The runner and deterministic helper tests are committed. Runtime PASS for the actual Session → model probe must only be recorded after `pnpm test:ec08:session-model-boundary` executes in an environment with Windows and a usable DSH CLI.
