import { homedir } from "node:os";
import { join } from "node:path";
import { ControllerTransport } from "./controller.js";
import { LaunchCoordinator } from "./coordinator.js";
import { UnixHerdrClient } from "./herdr.js";
import { Registry } from "./registry.js";

export function createHerdrProcessHost(options: { stateHome?: string; runtimeDir?: string; herdrSocket: string; runner: string }) {
  const stateHome = options.stateHome ?? process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state");
  const runtimeDir = options.runtimeDir ?? process.env.XDG_RUNTIME_DIR;
  if (!runtimeDir) throw new Error("XDG_RUNTIME_DIR is required for private IPC");
  const socketPath = join(runtimeDir, "bb-herdr/control.sock");
  const registry = new Registry(join(stateHome, "bb-herdr/registry.json"));
  const controller = new ControllerTransport(socketPath);
  const coordinator = new LaunchCoordinator(registry, new UnixHerdrClient(options.herdrSocket), options.runner, socketPath, controller);
  return { registry, controller, coordinator };
}

export default async function bbHerdrPlugin(bb: any) {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (!runtimeDir) throw new Error("XDG_RUNTIME_DIR is required for private IPC");
  const host = createHerdrProcessHost({ runtimeDir, herdrSocket: process.env.HERDR_SOCKET ?? join(runtimeDir, "herdr.sock"), runner: new URL("./runner.js", import.meta.url).pathname });
  await host.registry.load();
  await host.controller.listen();
  bb.processHosts?.register?.({ id: "herdr", displayName: "Herdr", launch: (launch: any) => host.coordinator.launch(launch), cancel: (id: string) => host.coordinator.cancel(id) });
  return { close: () => host.controller.close() };
}
