import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { FrameDecoder, decodeBytes, encodeBytes, encodeFrame, writeFrame } from "../src/protocol";
import { listenPrivate } from "../src/rendezvous";
import { ControllerTransport } from "../src/controller";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function createDirectory() { const path = await mkdtemp(join(tmpdir(), "bb-herdr-transport-")); directories.push(path); return path; }

function decodeFrames(bytes: Buffer) { const decoder = new FrameDecoder(); const frames = decoder.push(bytes); decoder.end(); return frames; }

describe("strict protocol", () => {
  test("rejects malformed schemas and non-canonical base64", () => {
    const malformed = [
      { type: "hello", launchId: "a", token: "t", extra: true },
      { type: "start", launchId: "" },
      { type: "data", stream: "stdout", bytes: "!!!!" },
      { type: "exit", code: 1.5, signal: null },
      { type: "unknown" },
    ];
    for (const frame of malformed) expect(() => decodeFrames(Buffer.from(`${JSON.stringify(frame)}\n`))).toThrow();
    expect(() => decodeBytes("YQ")).toThrow("base64");
  });

  test("applies the limit to each frame while permitting batches", () => {
    const frame = encodeFrame({ type: "start", launchId: "12345678" });
    const decoder = new FrameDecoder(frame.length);
    expect(decoder.push(Buffer.concat([frame, frame]))).toHaveLength(2);
    expect(() => new FrameDecoder(frame.length - 1).push(frame)).toThrow("limit");
  });

  test("serializes bounded writes under backpressure", async () => {
    const output = new PassThrough({ highWaterMark: 1 });
    let bytes = Buffer.alloc(0);
    output.on('data', chunk => { output.pause(); setTimeout(() => { bytes = Buffer.concat([bytes, chunk]); output.resume(); }, 2); });
    await Promise.all([
      writeFrame(output, { type: "data", stream: "stdout", bytes: encodeBytes(Buffer.from("first")) }),
      writeFrame(output, { type: "data", stream: "stderr", bytes: encodeBytes(Buffer.from("second")) }),
    ]);
    output.end(); await once(output, "end");
    expect(decodeFrames(bytes).map(frame => frame.type === "data" ? decodeBytes(frame.bytes).toString() : "")).toEqual(["first", "second"]);
  });
});

describe("private controller and real runner", () => {
  test("authenticates association and relays binary streams through final exit drain", async () => {
    const directory = await createDirectory(); const socketPath = join(directory, "control.sock");
    const transport = new ControllerTransport(socketPath, { maxBufferedBytes: 64 * 1024 });
    const server = await transport.listen(); expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
    const session = transport.expect({ launchId: "binary", token: "secret" });
    const child = spawn(process.execPath, [join(process.cwd(), "src/runner.ts"), "--", process.execPath, "-e", "process.stdin.on('data',b=>{process.stdout.write(b);process.stderr.write(Buffer.from([0,255]));process.exit(7)})"], { env: { ...process.env, BB_HERDR_LAUNCH_ID: "binary", BB_HERDR_TOKEN: "secret", BB_HERDR_SOCKET: socketPath }, stdio: ["ignore", "ignore", "inherit"] });
    const childExit = once(child, "exit"); await session.started; await session.writeStdin(Buffer.from([0, 10, 255])); await session.endStdin();
    const result = await session.completed;
    expect(Buffer.concat(result.stdout)).toEqual(Buffer.from([0, 10, 255])); expect(Buffer.concat(result.stderr)).toEqual(Buffer.from([0, 255])); expect(result.exit).toEqual({ code: 7, signal: null }); expect(result.cleanup).toEqual({ launchId: "binary", token: "secret" });
    expect((await childExit)[0]).toBe(0); await transport.close(); expect(server.listening).toBe(false);
  });

  test("rejects unauthenticated starts and malformed batches", async () => {
    const directory = await createDirectory(); const socketPath = join(directory, "control.sock"); const transport = new ControllerTransport(socketPath); await transport.listen(); transport.expect({ launchId: "good", token: "secret" });
    const socket = createConnection(socketPath); await once(socket, "connect"); socket.write(Buffer.concat([encodeFrame({ type: "hello", launchId: "good", token: "wrong" }), encodeFrame({ type: "start", launchId: "good" })]));
    await once(socket, "close"); expect(transport.pendingCount).toBe(1); await transport.close();
  });

  test("cancels a child and escalates after controller loss", async () => {
    const directory = await createDirectory(); const fixture = join(directory, "fixture.ts"); await writeFile(fixture, "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"); await chmod(fixture, 0o700);
    for (const mode of ["cancel", "loss"] as const) {
      const socketPath = join(directory, `${mode}.sock`); const transport = new ControllerTransport(socketPath); await transport.listen(); const session = transport.expect({ launchId: mode, token: "secret" });
      const child = spawn(process.execPath, [join(process.cwd(), "src/runner.ts"), "--", process.execPath, fixture], { env: { ...process.env, BB_HERDR_LAUNCH_ID: mode, BB_HERDR_TOKEN: "secret", BB_HERDR_SOCKET: socketPath }, stdio: ["ignore", "ignore", "inherit"] });
      const childExit = once(child, "exit"); await session.started; if (mode === "cancel") await session.cancel(); else await transport.close();
      const [code, signal] = await childExit as [number | null, string | null]; expect(code === 0 || signal === "SIGKILL").toBe(true); if (mode === "cancel") await transport.close();
    }
  }, 10_000);
});
