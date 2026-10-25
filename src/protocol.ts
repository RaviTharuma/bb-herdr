import { once } from "node:events";
import type { Writable } from "node:stream";
export type Frame = {type:"hello";launchId:string;token:string}|{type:"start";launchId:string}|{type:"data";stream:"stdin"|"stdout"|"stderr";bytes:string}|{type:"cancel";launchId:string}|{type:"exit";code:number|null;signal:string|null}|{type:"cleanup";launchId:string;token:string};
export class FrameDecoder { #buffer=Buffer.alloc(0); constructor(readonly maxBytes=1024*1024){} push(chunk:Uint8Array):Frame[]{ this.#buffer=Buffer.concat([this.#buffer,chunk]); if(this.#buffer.length>this.maxBytes) throw new Error("frame buffer limit exceeded"); const out:Frame[]=[]; for(;;){const i=this.#buffer.indexOf(10);if(i<0)return out;const line=this.#buffer.subarray(0,i);this.#buffer=this.#buffer.subarray(i+1);if(line.length)out.push(JSON.parse(line.toString("utf8")));}} end(){if(this.#buffer.length)throw new Error("truncated frame");}}
export const encodeFrame=(frame:Frame)=>Buffer.from(JSON.stringify(frame)+"\n");
export async function writeFrame(out:Writable, frame:Frame){if(!out.write(encodeFrame(frame))) await once(out,"drain");}
export const encodeBytes=(bytes:Uint8Array)=>Buffer.from(bytes).toString("base64");
export const decodeBytes=(value:string)=>Buffer.from(value,"base64");
