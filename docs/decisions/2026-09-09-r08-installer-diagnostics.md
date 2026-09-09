# R08.4 keeps installer checks reversible and diagnostics redacted

The development checkout is not installation evidence. Installer checks therefore validate metadata and artifact discovery without changing registry state, startup configuration, browser extensions, or Harness user data. With the current inactive Tauri bundle, the probe returns NOT RUN with exit code 2 so a development build cannot be mistaken for an install candidate.

Support diagnostics retain only versions, candidate identity, bridge reachability, error codes, capture phase, pause state, and counters. Material text, URLs, prompts, answers, file paths, credentials, and authorization values are redacted recursively. A later packaging task must bind the same redaction rules to first-launch and failure exports before any clean-environment smoke.
