// An engine in this process: an Exec that runs runEngine on a temporary
// "remote" cache, with a fake render, so the whole protocol is exercised
// without SSH. Machine names here are made up.

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { RenderResult, RenderTimelineOptions } from "@av/remotion-composer";
import { runEngine, type EngineContext } from "../src/engine.js";
import type { EngineVersion } from "../src/protocol.js";
import type { Exec, ExecInput } from "../src/ssh.js";

export function tempDir(prefix = "rw-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function sha256(bytes: Buffer | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function version(overrides: Partial<EngineVersion> = {}): EngineVersion {
  return { commit: null, synced: null, node: "v0.0.0", ffmpeg: null, bun: null, remotion: null, browser: true, mismatches: [], ...overrides };
}

/** The words after engine.sh in a command line (the shell quoting here is only ever plain words or '…'). */
export function engineArgs(command: string): string[] {
  const at = command.lastIndexOf("engine.sh");
  if (at < 0) return [];
  const words = command.slice(at + "engine.sh".length).match(/'[^']*'|\S+/g) ?? [];
  const args = words.map((w) => (w.startsWith("'") ? w.slice(1, -1) : w));
  if (args[0] === "--cache") args.splice(0, 2);
  return args;
}

function asIterable(stdin: ExecInput["stdin"]): AsyncIterable<Buffer | string> {
  if (stdin === undefined) return Readable.from([]);
  if (typeof stdin === "string" || Buffer.isBuffer(stdin)) return Readable.from([Buffer.from(stdin)]);
  return stdin;
}

export interface FakeEngine {
  exec: Exec;
  cache: string;
  calls: { destination: string; command: string }[];
  renders: RenderTimelineOptions[];
  /** Destinations that refuse SSH (exit 255) and those reachable without an engine (exit 127). */
  unreachable: Set<string>;
  noEngine: Set<string>;
  state: { commit: string | null; synced: string | null };
}

export function fakeEngine(options: { render?: EngineContext["render"] } = {}): FakeEngine {
  const cache = tempDir("rw-engine-");
  const engine: FakeEngine = {
    cache,
    calls: [],
    renders: [],
    unreachable: new Set(),
    noEngine: new Set(),
    state: { commit: null, synced: null },
    exec: async (destination, command, input = {}) => {
      engine.calls.push({ destination, command });
      if (engine.unreachable.has(destination)) return { code: 255, stdout: "", stderr: "ssh: connect to host: Connection timed out" };
      if (engine.noEngine.has(destination) && !command.includes("git checkout")) return { code: 127, stdout: "", stderr: "engine.sh: No such file or directory" };
      const checkout = /git checkout --quiet --force -B engine (\S+)/.exec(command);
      if (checkout) {
        engine.noEngine.delete(destination);
        engine.state.commit = checkout[1]!;
      }
      const out: Buffer[] = [];
      const stdout = input.stdout ?? new PassThrough();
      if (!input.stdout) stdout.on("data", (b: Buffer) => out.push(b));
      const stderr: string[] = [];
      const code = await runEngine(engineArgs(command), {
        stdin: asIterable(input.stdin),
        stdout,
        stderrLine: (line) => {
          stderr.push(line);
          input.onStderrLine?.(line);
        },
      }, {
        repo: "/nowhere",
        cache,
        version: async () => version({ commit: engine.state.commit, synced: engine.state.synced }),
        sync: async (sha) => {
          engine.state.synced = sha;
        },
        concurrency: () => ({ concurrency: 3, browsers: 1 }),
        render: async (o) => {
          engine.renders.push(o);
          return (options.render ?? fakeRender)(o);
        },
      });
      await new Promise<void>((done) => {
        stdout.end(() => done());
      });
      return { code, stdout: Buffer.concat(out).toString("utf-8"), stderr: stderr.join("\n") };
    },
  };
  return engine;
}

/** Checks every asset is where the timeline says, with its hash, and "renders" their concatenation. */
export async function fakeRender(o: RenderTimelineOptions): Promise<RenderResult> {
  const timeline = o.timeline as { assets: Record<string, { path: string; hash: string }> };
  const parts: Buffer[] = [];
  for (const [id, asset] of Object.entries(timeline.assets)) {
    const file = path.resolve(o.assetRoot, asset.path);
    if (!existsSync(file)) throw Object.assign(new Error(`asset ${id} is not at ${file}`), { code: "asset-missing", problems: [{ code: "asset-missing", message: id, path: `$.assets.${id}` }] });
    const bytes = readFileSync(file);
    if (sha256(bytes) !== asset.hash) throw new Error(`asset ${id} has the wrong bytes`);
    parts.push(bytes);
  }
  for (const kit of o.kits ?? []) {
    if (sha256(readFileSync(kit.file)) !== kit.hash) throw new Error(`kit ${kit.name} has the wrong bytes`);
  }
  o.onProgress?.(0.5);
  o.onProgress?.(1);
  const video = Buffer.concat([Buffer.from("MP4:"), ...parts]);
  writeFileSync(o.outputPath, video);
  return { path: o.outputPath, durationSeconds: 2, sizeBytes: video.length, hash: sha256(video), kits: [], profile: "test", loudness: null };
}
