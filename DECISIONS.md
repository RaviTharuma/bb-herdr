# DECISIONS

Follow the fleet-wide guidance in `~/.agents/DECISIONS.md` when it exists. This repository-specific file records only bb-herdr requirements.

```toon
format: toon
version: 4.4
project: bb-herdr
status: initial vertical slice
```

## 2026-10-25 — TypeScript first, Rust only for proven supervision gaps

The generic BB extension and bb-herdr plugin use strict TypeScript and TSX, following BB's SDK, UI, build, and runtime conventions. The transport shim and runner also begin in TypeScript.

A narrowly scoped Rust helper may be introduced only when failure-injection tests on a supported platform prove that BB's existing process utilities and Node cannot provide the required process ownership, termination, or cleanup receipt. Such a helper stays behind a versioned local protocol and may own only process launch, streams, containment, termination, and cleanup evidence. It does not own provider selection, permissions, conversations, approvals, recovery, or Herdr workspace policy.

A Rust implementation is not itself cleanup proof; every platform must pass the same lifecycle and crash tests before certification.

```toon
languageDecision:
  primary: TypeScript
  ui: TSX
  nativeHelper: conditional Rust
  rustGate: measured supervision failure
  protocol: versioned local IPC
```
