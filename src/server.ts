import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ControllerTransport } from "./controller.js";
import { LaunchCoordinator } from "./coordinator.js";
import { UnixHerdrClient } from "./herdr.js";
import { Registry } from "./registry.js";
const executeFile = promisify(execFile);
export function assertSupportedRuntime(platform = process.platform, arch = process.arch) {
  if (!((platform === "linux" && arch === "x64") || (platform === "darwin" && arch === "arm64"))) throw new Error(`unsupported runtime: ${platform}-${arch}; supported: linux-x64, darwin-arm64`);
}
async function configuredHerdrSocket() {
  const { stdout } = await executeFile("herdr", ["status", "server", "--json"], { timeout: 5000 });
  const status = JSON.parse(stdout) as { socket?: unknown };
  if (typeof status.socket !== "string" || !status.socket) throw new Error("Herdr did not report its configured socket");
  return status.socket;
}
export async function resolveHerdrSocket(environment: NodeJS.ProcessEnv = process.env, discover = configuredHerdrSocket) { return environment.HERDR_SOCKET || await discover(); }
export function createHerdrProcessHost(options: { stateHome?: string; runtimeDir: string; herdrSocket: string; runner: string }) {
  const stateHome = options.stateHome ?? process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state");
  const socketPath = join(options.runtimeDir, "bb-herdr/control.sock");
  const registry = new Registry(join(stateHome, "bb-herdr/registry.json"));
  const controller = new ControllerTransport(socketPath);
  const coordinator = new LaunchCoordinator(registry, new UnixHerdrClient(options.herdrSocket), options.runner, socketPath, controller);
  return { registry, controller, coordinator };
}
export default async function bbHerdrPlugin(bb: any) {
  assertSupportedRuntime();
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? await mkdtemp(join(tmpdir(), "bb-herdr-"));
  const host = createHerdrProcessHost({ runtimeDir, herdrSocket: await resolveHerdrSocket(), runner: fileURLToPath(new URL("./runner.js", import.meta.url)) });
  await host.registry.load(); await host.controller.listen();
  bb.processHosts?.register?.({ id: "herdr", displayName: "Herdr", launch: (launch: any) => host.coordinator.launch(launch), cancel: (id: string) => host.coordinator.cancel(id) });
  return { close: () => host.controller.close() };
}
