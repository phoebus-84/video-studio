// A renderer with renderTimeline's shape that shares a video among machines:
// its one-second segments wait in a queue (queue.ts), each machine draws
// chunk after chunk of them (into its own cache, so a later render reuses
// them) until the queue is empty, and one of them, local or remote,
// assembles the video from everyone's segments with the soundtrack and
// loudness. Segments travel through this machine: an
// engine only ever talks to the machine that drives it.

import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import { finished } from "node:stream/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { DrawSegmentsOptions, DrawSegmentsResult, RenderResult, RenderTimelineOptions, SegmentDrawer } from "@av/remotion-composer";
import { prepareJob, type PreparedJob } from "./files.js";
import { readHostsConfig } from "./hosts.js";
import { decodeBundle, drawnPath, encodeBundle, RenderWorkerError, type DrawAnswer } from "./protocol.js";
import { SegmentQueue } from "./queue.js";
import { readSpeeds, recordSpeeds, speedKey, weightsFor } from "./speeds.js";
import { call, engineFacts, fetchVideo, openDrawSession, openEngine, renderOn, sendFiles, type DrawSession, type EngineAnswer, type EngineSession, type RemoteRendererOptions } from "./remote.js";

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
  /** Where the machines' measured speeds are kept: the first chunks follow them, or render-hosts.json's `speed`. */
  speedsFile?: string;
}

/** One machine's share: its segments, as runs [from, to], how long it drew them, and the weight its first chunk followed. */
export interface SharedShare { host: string; segments: number; runs: [number, number][]; seconds: number; weight: number }

/** Neighbouring segments as runs [from, to]. */
export function runsOf(segments: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const i of [...segments].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

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
    const runs = order.map((i) => ({ host: hosts[i]!, key: keys[i]!, weight: weights[i]!, segments: [] as number[] }));
    const front = drawers.includes(LOCAL) ? LOCAL : drawers[0];
    const queue = new SegmentQueue(total, runs.map((r) => ({ host: r.host, prior: r.weight, fromFront: r.host === front })));
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

    // Overall progress: the segments are 90%, the assembly the rest.
    let segmentsDone = 0;
    const chunkDone = new Map<string, number>();
    let assembly = 0;
    let reported = 0;
    const report = () => {
      const drawn = (segmentsDone + [...chunkDone.values()].reduce((a, b) => a + b, 0)) / total;
      reported = Math.max(reported, 0.9 * Math.min(1, drawn) + 0.1 * assembly);
      render.onProgress?.(reported);
    };
    const chunkProgress = (host: string, size: number) => (p: number) => {
      chunkDone.set(host, Math.min(1, p) * size);
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
    /** Segments each machine drew now, not from its cache: what its speed is measured on. */
    const drawnNow = new Map<string, number>();
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

    // This machine's share is drawn by one drawer: the bundle and the browsers
    // once, not for every chunk (a minute each, while the chunk waits on it).
    const { outputPath: _out, onProgress: _p, drawn: _d, loudness: _l, ...drawOptions } = render;
    let localDrawer: Promise<SegmentDrawer> | undefined;
    const openLocal = () => (localDrawer ??= import("@av/remotion-composer").then((c) => c.openSegmentDrawer({ ...drawOptions, cacheDir: render.cacheDir!, dir: sharedDir })));
    const closeLocal = async () => {
      const opened = localDrawer;
      localDrawer = undefined;
      await (await opened?.catch(() => undefined))?.close();
    };

    // A remote's share is drawn on one engine command too, for the same reason.
    const sessions = new Map<string, Promise<DrawSession>>();
    const sessionOf = (host: string) => {
      let opened = sessions.get(host);
      if (!opened) {
        opened = (async () => openDrawSession(await engineOf(host), (await prepared()).job))();
        sessions.set(host, opened);
      }
      return opened;
    };
    /** Ends the draw sessions, which hold their engines' render lock; the first failure, unless `quiet`. */
    const closeSessions = async (quiet: boolean) => {
      const opened = [...sessions.values()];
      sessions.clear();
      const closed = await Promise.allSettled(opened.map(async (s) => (await s).close()));
      const failed = closed.find((c): c is PromiseRejectedResult => c.status === "rejected");
      if (failed && !quiet) throw failed.reason;
    };

    /** One chunk of `host`'s; the soundtrack too on its first, when it assembles. */
    const drawChunk = async (host: string, segments: number[], first: boolean) => {
      const onProgress = chunkProgress(host, segments.length);
      if (host === LOCAL) {
        const audio = first && assembler === LOCAL;
        const result = options.draw
          ? await options.draw({ ...drawOptions, cacheDir: render.cacheDir!, segments, dir: sharedDir, audio, onProgress })
          : await (await openLocal()).draw({ segments, audio, onProgress });
        for (const s of result.segments) held.set(s.index, { file: s.file, hash: s.hash, bytes: s.bytes });
        drawnNow.set(host, (drawnNow.get(host) ?? 0) + (result.cache?.segmentsRendered ?? segments.length));
        await pushToAssembler(segments);
        return;
      }
      const engine = await engineOf(host);
      const answer = await (await sessionOf(host)).draw({ segments, audio: first && host === assembler }, onProgress);
      answers.set(host, answer.engine);
      drawnNow.set(host, (drawnNow.get(host) ?? 0) + (answer.rendered ?? segments.length));
      if (answer.totalSegments !== total) throw new RenderWorkerError("engine-failed", `${host} counts ${answer.totalSegments} segments, this machine ${total}`);
      if (host === assembler) {
        for (const s of answer.segments) assemblerHas.set(s.index, s.hash);
        return;
      }
      await pullFrom(engine, answer);
      await pushToAssembler(segments);
    };

    /** `host` draws chunks from the queue until it has nothing more to draw. */
    const drawShare = async (run: (typeof runs)[number]) => {
      const { host } = run;
      // Its speed is its drawing, not the code and files it was sent first,
      // nor the bundle it draws with: no chunk waits on them.
      if (host === LOCAL && !options.draw) await openLocal();
      if (host !== LOCAL) {
        try {
          await engineOf(host);
        } catch (error) {
          // It holds nothing yet: the others draw its part, unless it must assemble.
          if (host === assembler || abort.signal.aborted) throw error;
          queue.leave(host);
          log(`warning: ${host} does not draw, the others draw its part: ${(error as Error).message}`);
          return;
        }
      }
      for (let chunk = queue.take(host), first = true; chunk.length > 0; chunk = queue.take(host), first = false) {
        const started = Date.now();
        await drawChunk(host, chunk, first);
        const took = (Date.now() - started) / 1000;
        queue.done(host, took);
        run.segments.push(...chunk);
        seconds.set(host, (seconds.get(host) ?? 0) + took);
        chunkDone.delete(host);
        segmentsDone += chunk.length;
        report();
        log(`${host}: ${chunk[0]}–${chunk.at(-1)} in ${took.toFixed(0)} s, ${queue.left} s of video left`);
      }
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
      log(`shared render: ${total} s among ${drawers.join(", ")} chunk by chunk, starting by speed ${runs.map((r) => r.weight.toFixed(3)).join(" : ")}; ${assembler} assembles`);
      const work = runs.map(drawShare);
      // A remote assembler that draws nothing still needs the files.
      if (assembler !== LOCAL && !drawers.includes(assembler)) work.push(engineOf(assembler).then(() => undefined));
      const settled = await Promise.allSettled(work.map((w) => w.catch((e: unknown) => {
        abort.abort(e);
        throw e;
      })));
      // Its browsers leave the assembly the memory; a remote assembler's lock is free again.
      await closeLocal();
      const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
      await closeSessions(failed !== undefined);
      if (failed) throw failed.reason;
      if (options.speedsFile) {
        try {
          recordSpeeds(options.speedsFile, runs.map((r) => ({ key: r.key, segments: drawnNow.get(r.host) ?? 0, seconds: seconds.get(r.host) ?? 0 })));
        } catch (error) {
          log(`warning: the machines' speeds were not saved: ${(error as Error).message}`);
        }
      }

      log(`${assembler} assembles the video`);
      const onAssembly = (p: number) => {
        assembly = p;
        report();
      };
      const shares: SharedShare[] = runs.map((r) => ({ host: r.host, segments: r.segments.length, runs: runsOf(r.segments), seconds: seconds.get(r.host) ?? 0, weight: r.weight }));
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
      await closeLocal();
      await closeSessions(true);
      rmSync(sharedDir, { recursive: true, force: true });
    }
  };
}
