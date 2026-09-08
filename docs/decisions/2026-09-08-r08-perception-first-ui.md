# R08 perception-first Lens interaction

Date: 2026-09-08

## Decision

The Lens product exposes two user initiated actions: Explain for the fixed selection and Ask for a contextual follow-up. Translation is outside the product scope. The UI, request action union, locale dictionary, prompts, tests and acceptance documents must not expose or implement a translation action.

The interaction order keeps the fixed material and source visible, places Explain as the primary action, and keeps the question composer available for follow-up. A completed answer remains visible after the terminal event, while streaming answers use a polite live region. Session history remains owned by Harness and is selected or created explicitly by the user.

## Rationale

The product objective is perception enhancement: reduce context switching, working-memory load and material mix-ups while the user reads. A translation action would expand the product objective and compete with the fixed-material understanding loop. Removing it also prevents a visible capability from being mistaken for a supported model workflow.

## Consequences

The quick-action area has one primary Explain button; contextual questions remain available through the composer. Any future language conversion capability requires a new product decision, explicit session semantics and separate evidence. Locale support continues to localize interface copy and accessibility names; it does not add language-conversion behavior.

## Verification

`pnpm test:ui:a11y` verifies the labelled Explain, Ask, session and close controls. `pnpm --dir native test` verifies the Lens state and session behavior. `pnpm test:ui:visual` verifies the responsive, dark-theme, reduced-motion and high-contrast rules plus the current Tauri screenshots in [R08 UI evidence](../evidence/r08-ui.md).
