#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createConnection } from "node:net";
import { decodeBytes, encodeBytes, FrameDecoder, writeFrame } from "./protocol.js";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
if (!command.length) throw new Error("usage: bb-herdr-runner -- command");
const launchId = process.env.BB_HERDR_LAUNCH_ID; const token = process.env.BB_HERDR_TOKEN; const socketPath = process.env.BB_HERDR_SOCKET;
if (!launchId || !token || !socketPath) throw new Error("runner association is required");
for (const key of ["BB_HERDR_LAUNCH_ID", "BB_HERDR_TOKEN", "BB_HERDR_SOCKET"]) delete process.env[key];
const socket = createConnection(socketPath); await Promise.race([once(socket, "connect"), once(socket, "error").then(([error]) => Promise.reject(error))]);
await writeFrame(socket, { type: "hello", launchId, token }); await writeFrame(socket, { type: "start", launchId });
const child = spawn(command[0]!, command.slice(1), { stdio: ["pipe", "pipe", "pipe"], env: process.env });
await Promise.race([once(child, "spawn"), once(child, "error").then(([error]) => Promise.reject(error))]);
let isExiting = false; let forceTimer: NodeJS.Timeout | undefined;
function terminate() { if (isExiting) return; child.kill("SIGTERM"); forceTimer ??= setTimeout(() => child.kill("SIGKILL"), 250); }
const decoder = new FrameDecoder();
socket.on("data", chunk => { try { for (const frame of decoder.push(Buffer.from(chunk))) { if (frame.type === "data" && frame.stream === "stdin") { if (!child.stdin.write(decodeBytes(frame.bytes))) socket.pause(), child.stdin.once("drain", () => socket.resume()); } else if (frame.type === "eof") child.stdin.end(); else if (frame.type === "cancel" && frame.launchId === launchId) terminate(); else throw new Error("unexpected controller frame"); } } catch { socket.destroy(); terminate(); } });
socket.on("close", terminate); socket.on("error", terminate);
const writes: Promise<void>[] = [];
for (const [stream, source] of [["stdout", child.stdout], ["stderr", child.stderr]] as const) source.on("data", bytes => writes.push(writeFrame(socket, { type: "data", stream, bytes: encodeBytes(bytes) })));
const [code, signal] = await once(child, "close") as [number | null, NodeJS.Signals | null]; isExiting = true; if (forceTimer) clearTimeout(forceTimer); await Promise.all(writes);
if (!socket.destroyed) { await writeFrame(socket, { type: "exit", code, signal }); await writeFrame(socket, { type: "cleanup", launchId, token }); socket.end(); if (!socket.closed) await once(socket, "close"); }
