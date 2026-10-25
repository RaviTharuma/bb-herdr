import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

export interface HerdrClient { openPane(command: string[], cwd: string, env: Record<string, string>): Promise<string>; closePane(id: string): Promise<void> }
type HerdrOptions = { timeoutMs?: number; maxResponseBytes?: number };

export class UnixHerdrClient implements HerdrClient {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  constructor(readonly socketPath: string, options: HerdrOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 1024 * 1024;
  }
  async request(method: string, params: unknown): Promise<unknown> {
    return await new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      let body = "";
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(new Error(`Herdr request timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
      socket.on("connect", () => socket.end(JSON.stringify({ id: randomUUID(), method, params }) + "\n"));
      socket.on("data", (chunk) => {
        if (Buffer.byteLength(body) + chunk.length > this.maxResponseBytes) return finish(new Error("Herdr response too large"));
        body += chunk;
      });
      socket.on("end", () => {
        try {
          const response: unknown = JSON.parse(body);
          if (!response || typeof response !== "object") throw new Error("invalid Herdr response shape");
          const envelope = response as { error?: unknown; result?: unknown };
          if (envelope.error !== undefined) {
            const message = typeof envelope.error === "object" && envelope.error && "message" in envelope.error ? String(envelope.error.message) : "Herdr request failed";
            return finish(new Error(message));
          }
          if (!("result" in envelope)) throw new Error("invalid Herdr response shape");
          finish(undefined, envelope.result);
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      });
      socket.on("error", (error) => finish(error));
    });
  }
  async openPane(command: string[], cwd: string, env: Record<string, string>) {
    const result = await this.request("pane.split", { direction: "right", command, cwd, env });
    if (!result || typeof result !== "object" || typeof (result as { pane_id?: unknown }).pane_id !== "string" || !(result as { pane_id: string }).pane_id) {
      throw new Error("invalid Herdr pane response: pane_id is required");
    }
    return (result as { pane_id: string }).pane_id;
  }
  async closePane(paneId: string) { await this.request("pane.close", { pane_id: paneId }); }
}
