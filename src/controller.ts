import { once } from "node:events";
import type { Server, Socket } from "node:net";
import { decodeBytes, encodeBytes, FrameDecoder, writeFrame, type Frame } from "./protocol.js";
import { listenPrivate } from "./rendezvous.js";

type Exit = { code: number | null; signal: string | null };
type Result = { stdout: Buffer[]; stderr: Buffer[]; exit: Exit; cleanup: { launchId: string; token: string } };
type Association = { launchId: string; token: string };

export class ControllerSession {
  readonly stdout: Buffer[] = []; readonly stderr: Buffer[] = [];
  readonly started: Promise<void>; readonly completed: Promise<Result>;
  #resolveStarted!: () => void; #resolveCompleted!: (result: Result) => void; #rejectCompleted!: (error: Error) => void; #socket?: Socket; #exit?: Exit;
  constructor(readonly association: Association, readonly maxBufferedBytes: number) {
    this.started = new Promise(resolve => this.#resolveStarted = resolve);
    this.completed = new Promise((resolve, reject) => { this.#resolveCompleted = resolve; this.#rejectCompleted = reject; });
  }
  attach(socket: Socket) { this.#socket = socket; this.#resolveStarted(); }
  async writeStdin(bytes: Uint8Array) { if (!this.#socket) throw new Error("runner not started"); if (bytes.length > this.maxBufferedBytes) throw new Error("stdin limit exceeded"); await writeFrame(this.#socket, { type: "data", stream: "stdin", bytes: encodeBytes(bytes) }); }
  async endStdin() { if (!this.#socket) throw new Error("runner not started"); await writeFrame(this.#socket, { type: "eof", stream: "stdin" }); }
  async cancel() { if (!this.#socket) throw new Error("runner not started"); await writeFrame(this.#socket, { type: "cancel", launchId: this.association.launchId }); }
  receive(frame: Frame) {
    if (frame.type === "data" && (frame.stream === "stdout" || frame.stream === "stderr")) { const bytes = decodeBytes(frame.bytes); if (bytes.length > this.maxBufferedBytes) throw new Error("output limit exceeded"); this[frame.stream].push(bytes); }
    else if (frame.type === "exit") this.#exit = { code: frame.code, signal: frame.signal };
    else if (frame.type === "cleanup") { if (!this.#exit || frame.launchId !== this.association.launchId || frame.token !== this.association.token) throw new Error("invalid cleanup receipt"); this.#resolveCompleted({ stdout: this.stdout, stderr: this.stderr, exit: this.#exit, cleanup: { launchId: frame.launchId, token: frame.token } }); this.#socket?.end(); }
    else throw new Error("unexpected runner frame");
  }
  fail(error: Error) { this.#rejectCompleted(error); }
}

export class ControllerTransport {
  #pending = new Map<string, ControllerSession>(); #sockets = new Set<Socket>(); #server?: Server;
  constructor(readonly socketPath: string, readonly options: { maxFrameBytes?: number; maxBufferedBytes?: number } = {}) {}
  get pendingCount() { return this.#pending.size; }
  expect(association: Association) { const session = new ControllerSession(association, this.options.maxBufferedBytes ?? 1024 * 1024); this.#pending.set(association.launchId, session); return session; }
  async listen() { this.#server = await listenPrivate(this.socketPath, socket => this.#accept(socket)); return this.#server; }
  async close() { this.#pending.clear(); for (const socket of this.#sockets) socket.destroy(); if (!this.#server) return; const server = this.#server; this.#server = undefined; server.close(); if (server.listening) await once(server, "close"); }
  #accept(socket: Socket) {
    this.#sockets.add(socket); socket.once("close", () => this.#sockets.delete(socket));
    const decoder = new FrameDecoder(this.options.maxFrameBytes); let session: ControllerSession | undefined; let hello: Association | undefined;
    socket.on("data", chunk => { try { for (const frame of decoder.push(Buffer.from(chunk))) { if (!hello) { if (frame.type !== "hello") throw new Error("hello required"); const pending = this.#pending.get(frame.launchId); if (!pending || pending.association.token !== frame.token) throw new Error("authentication failed"); hello = frame; session = pending; } else if (!session?.association || frame.type !== "start" || frame.launchId !== hello.launchId) { if (!session) throw new Error("start required"); session.receive(frame); } else { this.#pending.delete(hello.launchId); session.attach(socket); } } } catch (error) { session?.fail(error as Error); socket.destroy(); } });
    socket.on("error", error => session?.fail(error));
  }
}
