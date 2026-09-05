# Development

This guide prepares a reproducible local checkout of dsh-selection-companion. It covers automated checks only. Browser UI Automation, native-window focus behaviour, installation, and real-model flows require the environments recorded in their task evidence.

## Prerequisites

Use Node.js 24.11.1, pnpm 11.7.0, and Rust 1.97.1 with rustfmt. rust-toolchain.toml selects the Rust toolchain for Cargo commands. Windows native checks also require the Tauri 2 Windows prerequisites and WebView2.

## Install dependencies

Run the following from the repository root:

~~~powershell
pnpm install --frozen-lockfile
~~~

Use pnpm install only when intentionally updating dependencies. Review the resulting pnpm-lock.yaml before committing it.

## Run automated checks

The portable TypeScript check validates the plugin package, its unit tests, build output, and bundle manifest:

~~~powershell
pnpm check
~~~

The Windows native aggregate builds the Tauri frontend before compiling Rust because Tauri validates native/dist at compile time:

~~~powershell
pnpm check:task5
cargo fmt --manifest-path native/src-tauri/Cargo.toml -- --check
~~~

pnpm check:task5 does not exercise a real desktop selection. Follow the relevant task's interactive Windows evidence procedure before declaring UI Automation, focus, DPI, or browser support verified.

## Evidence

Record each manual, platform, or model-backed result with [the test evidence template](test-evidence-template.md). Keep the recorded commit SHA and environment version with the result. A skipped environment check remains unverified.

## Protocol

Read [the protocol contract](protocol.md) before changing IPC message types, payloads, fixtures, or the native bridge. The contract check runs TypeScript and Rust against the same valid and invalid JSON fixtures.

## Decisions

Use [the decision record convention](decisions/README.md) for non-trivial choices that affect protocol, lifecycle, privacy, user interaction, or release behaviour.
