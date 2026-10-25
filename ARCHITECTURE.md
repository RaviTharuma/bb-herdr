# ARCHITECTURE

Follow the fleet-wide guidance in `~/.agents/ARCHITECTURE.md` when it exists. This repository-specific file records only bb-herdr requirements.

```toon
format: toon
version: 4.4
project: bb-herdr
status: initial vertical slice
```

## Language boundary

All BB-facing contracts, plugin behavior, Herdr orchestration, transport framing, state, and UI are strict TypeScript/TSX. The initial shim and runner are TypeScript. A native Rust helper is permitted only behind the versioned local protocol when platform failure tests demonstrate a supervision capability gap; its authority is limited to process containment and cleanup evidence.

```toon
languageBoundary:
  typescript: [BB contract, plugin, Herdr client, protocol, state, UI, runner, shim]
  rust: [conditional process containment, conditional cleanup receipt]
  excludedFromRust: [provider semantics, conversations, approvals, recovery, workspace policy]
```
