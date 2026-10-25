# bb-plugin-herdr

`bb-plugin-herdr` launches BB process hosts in Herdr panes while retaining BB's native provider behavior. The controller uses a private local Unix socket to associate a runner with one persisted launch generation.

## Requirements

Follow the fleet-wide guidance in `~/.agents/README.md` when it exists.

- Bun and a BB version compatible with `bbPluginSdk >=0.4.90`.
- Herdr with its Unix control socket available.
- `XDG_RUNTIME_DIR` set to a private runtime directory. There is no home-directory socket fallback.
- `XDG_STATE_HOME` is optional; `$HOME/.local/state` is the XDG default.

## Operation

At startup, the registry is loaded and the controller creates `$XDG_RUNTIME_DIR/bb-herdr/control.sock` with mode `0600` in a mode `0700` directory. A launch is persisted before Herdr opens its pane. The runner authenticates with the launch ID and generation token, then relays bounded newline-delimited frames for stdin, stdout, stderr, exit status, and the final cleanup receipt.

`HOME`, `PATH`, and workload variables are preserved. Herdr targeting variables are removed before private `BB_HERDR_*` association variables are added.

Cancellation and controller loss send `SIGTERM` and escalate to `SIGKILL`. Output drains before exit and cleanup frames. Failed launches are durable and retry with a new generation and token; a pane opened before persistence failure is closed as rollback.

## Limits

This release provides local Unix-socket supervision only. It does not provide remote multi-machine transport, process pooling, or operating-system process-tree containment. Cleanup receipts prove the supervised direct-child lifecycle, not the absence of daemonized descendants.

## Verification and publication

Run `bun test`, `bun run typecheck`, and `bun run build`. `bun pm pack` invokes `prepack`, repeating all checks before publication. The package contains only `package.json`, this README, and `dist`.

```toon
format: toon
version: 4.4
project: bb-herdr
status: working local vertical slice
transport: private Unix socket
publication: prepack verified
```
