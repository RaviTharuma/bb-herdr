# HANDOFF

Follow the fleet-wide guidance in `~/.agents/HANDOFF.md` when it exists. This repository-specific file records only bb-herdr requirements.

```toon
format: toon
version: 4.4
project: bb-herdr
status: initial vertical slice
```

```toon
managedHostedBridge:
  status: implemented
  api: live streams and lifecycle promises
  verification: pending final commands
```

## Release 0.2.0

```toon
release:
  branch: release/0.2.0
  status: built and locally verified, not committed or pushed
  plugin: BB-native package layout
  artifacts: [dist/server.js, dist/server.meta.json]
  platforms: [linux-x64, darwin-arm64]
  verification: 31 tests passing repeatedly; typecheck and native BB build passing
  productionConfigTouched: false
```
