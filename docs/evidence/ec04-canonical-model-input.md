# EC-04 — Canonical Authorized Material → Model Input

## Goal

Make the canonical `SelectionMaterial` created by explicit Lens authorization the only source used to construct model-visible reference text.

This phase intentionally does **not** change the Tauri/Rust `session.submit.material` transport yet. That durable transport migration is EC-05.

## Implemented boundary

The request path is now:

```text
immutable SelectionSnapshot
        |
        +-- default --------------------------> SelectionMaterial(selection)
        |
        +-- Load context --> preview only
                              |
                              +-- explicit authorization
                                      |
                                      v
                             canonical SelectionMaterial
                                      |
                       +--------------+--------------+
                       |                             |
                       v                             v
             Lens send preview              model-visible prompt
                       |                             |
                       +------ same renderer -------+
```

`native/src/requestMaterial.ts` owns the deterministic rendering boundary:

- `renderAuthorizedMaterialReference(material)` renders only fields already present in canonical material.
- `buildAuthorizedMaterialPrompt(material, userRequest)` appends the user request to that exact reference block.
- It never receives `SelectionExpansion`, so preview-only context cannot enter model input accidentally.

## Lens behavior

`native/src/App.tsx` now:

- resolves the current canonical material from `authorizedMaterial`, falling back to selection-only material when authorization is absent or stale;
- builds every Explain/Ask prompt with `buildAuthorizedMaterialPrompt`;
- renders **What Harness will receive** from the same `renderAuthorizedMaterialReference` function;
- keeps `Load context` preview-only;
- includes local/section/page context in model input only after explicit authorization;
- freezes the resulting prompt into `pendingSubmission`, so an unknown-submission retry reuses the exact same model input and request identity.

## Automated coverage

`native/src/requestMaterial.test.ts` covers:

- selection-only rendering;
- local/section/page scope isolation;
- completeness/truncation metadata;
- exact relationship between send preview and final prompt;
- blank user request rejection.

`native/src/ec04-model-input.test.tsx` covers:

- loaded-but-not-authorized expanded context is absent from both send preview and submitted prompt;
- explicitly authorized local context appears in both send preview and submitted prompt;
- captured context outside canonical authorization never leaks into the submitted prompt;
- unknown-submission retry reuses the exact same prompt.

Verification command:

```powershell
pnpm check:ec04
```

The command chains EC-01 → EC-04 regression coverage and the new Native tests.

## Deliberately still open for EC-05

The Native API currently still calls Rust with the original `SelectionSnapshot`. Rust therefore still projects `session.submit.material` back to selection-only material.

So after EC-04:

- **model-visible UserMessage text** uses the explicitly authorized canonical material;
- **Lens send preview** uses the same canonical material;
- **durable `user/message.source.material`** remains selection-only until EC-05.

EC-05 must change the Native/Rust command boundary to carry `SelectionMaterial` directly, validate it in Rust, and transmit the exact same material over Protocol V4 without re-projecting from a snapshot.

## Verification status

The repository changes and automated tests are present. This evidence file does not claim a runtime PASS until `pnpm check:ec04` is executed in a checkout with the project Node/Rust toolchain installed.
