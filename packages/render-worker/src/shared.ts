// A renderer with renderTimeline's shape that shares a video among machines:
// its one-second segments are split into contiguous runs sized by how fast
// each machine drew before (speeds.ts), each machine draws
// its run (into its own cache, so a later render reuses them), and one of
// them, local or remote, assembles the video from everyone's segments with
// the soundtrack and loudness. Segments travel through this machine: an
// engine only ever talks to the machine that drives it.

import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { finished } from "node:stream/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { DrawSegmentsOptions, DrawSegmentsResult, RenderResult, RenderTimelineOptions } from "@av/remotion-composer";
import { prepareJob, type PreparedJob } from "./files.js";
import { readHostsConfig } from "./hosts.js";
import { decodeBundle, drawnPath, encodeBundle, RenderWorkerError, type DrawAnswer } from "./protocol.js";
import { readSpeeds, recordSpeeds, speedKey, splitByWeight, weightsFor } from "./speeds.js";
import { call, engineFacts, fetchVideo, openEngine, renderOn, sendFiles, type EngineAnswer, type EngineSession, type RemoteRendererOptions } from "./remote.js";

/** The machine this runs on, in `hosts` and `assembleOn`. */
export const LOCAL = "local";

export interface SharedRendererOptions extends Omit<RemoteRendererOptions, "host"> {
  /** The machines that draw: tailnet peers or render-hosts.json hosts, and "local" for this one. */
  hosts: string[];
  /** The machine that assembles the video; it draws a share only when it is also in `hosts`. Default "local". */
  assembleOn?: string;
  /** This machine's drawSegments and renderTimeline (the composer's, by default). */
  draw?: (options: DrawSegmentsOptions) => Promise<DrawSegmentsResult>;
  renderLocal?: (options: RenderTimelineOptions) => Promise<RenderResult>;
  /** Where the machines' measured speeds are kept; without it the split is even unless render-hosts.json sets `speed`. */
  speedsFile?: string;
}

/** One machine's share: its segments, how long it drew them, and the weight that sized it. */
export interface SharedShare { host: string; segments: number; from: number; to: number; seconds: number; weight: number }

export interface SharedRenderResult extends RenderResult {
  engine: {
    /** The machine that assembled the video. */
    host: string;
    commit: string | null;
    concurrency?: number;
    browsers?: number;
    sentFiles: number;
    sentBytes: number;
    assembler: string;
    shares: SharedShare[];
  };
}

/** A segment file on this machine, with what it hashes to. */
interface Held { file: string; hash: string; bytes: number }

export function sharedRenderer(options: SharedRendererOptions): (render: RenderTimelineOptions) => Promise<SharedRenderResult> {
  const hosts = [...new Set(options.hosts.map((h) => h.trim()).filter(Boolean))];
  const assembler = (options.assembleOn ?? LOCAL).trim() || LOCAL;
  if (hosts.length === 0) throw new RenderWorkerError("bad-request", "a shared render needs at least one machine to draw");
  if ([...hosts, assembler].includes("auto")) throw new RenderWorkerError("bad-request", "a shared render names its machines; \"auto\" is for a render on one engine");

  return async (render) => {
    const timeline = render.timeline as { durationInFrames?: number; fps?: number };
    if (!timeline.durationInFrames || !timeline.fps) throw new RenderWorkerError("bad-request", "the timeline has no durationInFrames or fps");
    const total = Math.ceil(timeline.durationInFrames / timeline.fps);
    const config = options.config ?? readHostsConfig(options.configFile);
    const keys = hosts.map((h) => speedKey(h, LOCAL));
    const weights = weightsFor(hosts, keys, readSpeeds(options.speedsFile), config);
    // More machines than seconds: the slowest ones sit out.
    const order = hosts.map((_, i) => i).sort((a, b) => weights[b]! - weights[a]!).slice(0, total).sort((a, b) => a - b);
    const drawers = order.map((i) => hosts[i]!);
    const counts = splitByWeight(total, order.map((i) => weights[i]!));
    let next = 0;
    const runs = drawers.map((host, k) => {
      const from = next;
      next += counts[k]!;
      return { host, key: keys[order[k]!]!, weight: weights[order[k]!]!, segments: Array.from({ length: counts[k]! }, (_, i) => from + i) };
    });
    const local = [...drawers, assembler].includes(LOCAL);
    if (local && !render.cacheDir) throw new RenderWorkerError("bad-request", "a shared render that draws or assembles here needs the render's cacheDir");

    const log = options.onLog ?? (() => undefined);
    const abort = new AbortController();
    const stop = () => abort.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", stop, { once: true });
    const remoteOptions = { ...options, signal: abort.signal };
    const sharedDir = `${render.outputPath}.shared`;
    rmSync(sharedDir, { recursive: true, force: true });
    mkdirSync(sharedDir, { recursive: true });

    // Overall progress: the shares are 90%, the assembly the rest.
    const drawnShare = new Map<string, number>();
    const logged = new Map<string, number>();
    let assembly = 0;
    const report = () => {
      const drawn = runs.reduce((n, r) => n + (drawnShare.get(r.host) ?? 0) * r.segments.length, 0) / total;
      render.onProgress?.(0.9 * drawn + 0.1 * assembly);
    };
    const shareProgress = (host: string) => (p: number) => {
      drawnShare.set(host, p);
      const step = Math.floor(p * 10);
      if (step > (logged.get(host) ?? -1)) {
        logged.set(host, step);
        log(`${host}: ${step * 10}% of its share`);
      }
      report();
    };

    const engines = new Map<string, Promise<EngineSession>>();
    const engineOf = (host: string) => {
      let opened = engines.get(host);
      if (!opened) {
        opened = (async () => {
          const engine = await openEngine({ ...remoteOptions, host });
          const job = await prepared();
          const sent = await sendFiles(engine, job.files);
          sentTo.set(host, sent);
          return engine;
        })();
        engines.set(host, opened);
      }
      return opened;
    };
    const sentTo = new Map<string, { sentFiles: number; sentBytes: number }>();
    let preparing: Promise<PreparedJob> | undefined;
    const prepared = () => (preparing ??= prepareJob(render));

    const held = new Map<number, Held>();
    const answers = new Map<string, EngineAnswer | undefined>();
    const seconds = new Map<string, number>();
    /** Segments on the remote assembler, by index → hash: its own share and what was pushed to it. */
    const assemblerHas = new Map<number, string>();

    /** Segments this machine holds, to the remote assembler's drawn/. */
    const pushToAssembler = async (indices: number[]) => {
      if (assembler === LOCAL || indices.length === 0) return;
      const engine = await engineOf(assembler);
      await call(engine.exec, engine.target, ["receive-drawn", engine.key], {
        stdin: encodeBundle(indices.map((i) => {
          const h = held.get(i)!;
          return { entry: { path: drawnPath(i), size: h.bytes, hash: h.hash }, read: () => createReadStream(h.file) };
        })),
        signal: abort.signal,
      }, "receive-drawn");
      for (const i of indices) assemblerHas.set(i, held.get(i)!.hash);
    };

    const drawShare = async ({ host, segments }: { host: string; segments: number[] }) => {
      let started = Date.now();
      const onProgress = shareProgress(host);
      if (host === LOCAL) {
        const { outputPath: _out, onProgress: _p, drawn: _d, loudness: _l, ...rest } = render;
        const draw = options.draw ?? (await import("@av/remotion-composer")).drawSegments;
        const result = await draw({ ...rest, cacheDir: render.cacheDir!, segments, dir: sharedDir, audio: assembler === LOCAL, onProgress });
        for (const s of result.segments) held.set(s.index, { file: s.file, hash: s.hash, bytes: s.bytes });
        seconds.set(host, (Date.now() - started) / 1000);
        onProgress(1);
        await pushToAssembler(segments);
        return;
      }
      const engine = await engineOf(host);
      const job = (await prepared()).job;
      // Its speed is its drawing, not the code and files it was sent first.
      started = Date.now();
      const answer = await renderOn<DrawAnswer>(engine, { ...job, drawOnly: { segments, audio: host === assembler } }, onProgress);
      answers.set(host, answer.engine);
      seconds.set(host, (Date.now() - started) / 1000);
      onProgress(1);
      if (answer.totalSegments !== total) throw new RenderWorkerError("engine-failed", `${host} counts ${answer.totalSegments} segments, this machine ${total}`);
      if (host === assembler) {
        for (const s of answer.segments) assemblerHas.set(s.index, s.hash);
        return;
      }
      await pullFrom(engine, answer);
      await pushToAssembler(segments);
    };

    /** A remote share's segments, into the shared folder, each checked against the engine's answer. */
    const pullFrom = async (engine: EngineSession, answer: DrawAnswer) => {
      const expected = new Map(answer.segments.map((s) => [s.index, s]));
      // Through a file: the bundle arrives while nothing else reads the SSH pipe.
      const bundle = path.join(sharedDir, `from-${engine.target.name.replace(/[^A-Za-z0-9._-]/g, "_")}.bundle`);
      await call(engine.exec, engine.target, ["send-drawn", engine.key], {
        stdin: JSON.stringify([...expected.keys()]),
        stdout: createWriteStream(bundle),
        signal: abort.signal,
      }, "send-drawn");
      let sink: { out: ReturnType<typeof createWriteStream>; hash: ReturnType<typeof createHash>; part: string } | null = null;
      try {
        await decodeBundle(createReadStream(bundle), {
          start(entry) {
            const part = path.join(sharedDir, `${path.posix.basename(entry.path)}.part`);
            sink = { out: createWriteStream(part), hash: createHash("sha256"), part };
          },
          async data(chunk) {
            sink!.hash.update(chunk);
            if (!sink!.out.write(chunk)) await new Promise<void>((r) => sink!.out.once("drain", () => r()));
          },
          async end(entry) {
            const s = sink!;
            sink = null;
            s.out.end();
            await finished(s.out);
            const hash = `sha256:${s.hash.digest("hex")}`;
            const index = Number(/segment-(\d+)\.mp4$/.exec(entry.path)?.[1]);
            const promised = expected.get(index);
            if (!promised || hash !== promised.hash || entry.size !== promised.bytes) {
              throw new RenderWorkerError("transfer-failed", `${engine.target.name}'s segment ${index} came as ${entry.size} bytes ${hash}, not what it drew`);
            }
            const file = path.join(sharedDir, `segment-${index}.mp4`);
            renameSync(s.part, file);
            held.set(index, { file, hash, bytes: entry.size });
          },
        }, "drawn");
      } finally {
        (sink as { out: { destroy(): void } } | null)?.out.destroy();
        rmSync(bundle, { force: true });
      }
      for (const index of expected.keys()) {
        if (!held.has(index)) throw new RenderWorkerError("transfer-failed", `${engine.target.name} did not send segment ${index}`);
      }
    };

    try {
      log(`shared render: ${runs.map((r) => `${r.host} ${r.segments[0]}–${r.segments.at(-1)}`).join(", ")} of ${total} s, by speed ${runs.map((r) => r.weight.toFixed(3)).join(" : ")}; ${assembler} assembles`);
      const work = runs.map(drawShare);
      // A remote assembler that draws nothing still needs the files.
      if (assembler !== LOCAL && !drawers.includes(assembler)) work.push(engineOf(assembler).then(() => undefined));
      const settled = await Promise.allSettled(work.map((w) => w.catch((e: unknown) => {
        abort.abort(e);
        throw e;
      })));
      const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
      if (failed) throw failed.reason;
      if (options.speedsFile) {
        try {
          recordSpeeds(options.speedsFile, runs.map((r) => ({ key: r.key, segments: r.segments.length, seconds: seconds.get(r.host) ?? 0 })));
        } catch (error) {
          log(`warning: the machines' speeds were not saved: ${(error as Error).message}`);
        }
      }

      log(`${assembler} assembles the video`);
      const onAssembly = (p: number) => {
        assembly = p;
        report();
      };
      const shares: SharedShare[] = runs.map((r) => ({ host: r.host, segments: r.segments.length, from: r.segments[0]!, to: r.segments.at(-1)!, seconds: seconds.get(r.host) ?? 0, weight: r.weight }));
      const sent = [...sentTo.values()].reduce((n, s) => ({ sentFiles: n.sentFiles + s.sentFiles, sentBytes: n.sentBytes + s.sentBytes }), { sentFiles: 0, sentBytes: 0 });

      if (assembler === LOCAL) {
        const renderLocal = options.renderLocal ?? (await import("@av/remotion-composer")).renderTimeline;
        const drawn = Object.fromEntries([...held].map(([i, h]) => [i, h.file]));
        const result = await renderLocal({ ...render, drawn, onProgress: onAssembly });
        return {
          ...result,
          engine: {
            host: LOCAL, commit: null,
            ...(render.concurrency !== undefined ? { concurrency: render.concurrency } : {}),
            ...(render.browsers !== undefined ? { browsers: render.browsers } : {}),
            ...sent, assembler, shares,
          },
        };
      }

      const engine = await engineOf(assembler);
      const missing = runs.flatMap((r) => r.segments).filter((i) => !assemblerHas.has(i));
      if (missing.length > 0) throw new RenderWorkerError("missing-file", `${assembler} lacks segments ${missing.join(", ")}`);
      const drawn = Object.fromEntries([...assemblerHas].map(([i, hash]) => [String(i), hash]));
      const result = await renderOn<RenderResult & { engine?: EngineAnswer }>(engine, { ...(await prepared()).job, ...(render.loudness ? { loudness: render.loudness } : {}), drawn }, onAssembly);
      await fetchVideo(engine, render.outputPath, result);
      const { engine: answered, ...rendered } = result;
      return {
        ...rendered,
        path: render.outputPath,
        engine: { host: engine.target.name, ...engineFacts(answered ?? answers.get(assembler), engine.sha), ...sent, assembler, shares },
      };
    } finally {
      options.signal?.removeEventListener("abort", stop);
      rmSync(sharedDir, { recursive: true, force: true });
    }
  };
}
