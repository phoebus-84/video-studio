// ---------------------------------------------------------------------------
// pva_extend_episode: a finished looping master made N hours long under a
// music-only soundtrack — the long version an ambient channel publishes.
//
// The video is the master repeated by the concat demuxer and stream-copied:
// nothing is re-encoded, so ten hours cost what writing the file costs. The
// soundtrack is planned by long-extend-plan.ts and rendered in ~10 min chunks,
// in parallel, each placing its clips by absolute sample, so the chunks join
// without a seam. pva_edit_audio's single filter graph does not get through
// an hour; this never holds more than a chunk.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { basename, extname, join } from "node:path";
import { audioDuration, loudness, silences } from "@av/audio-edit";
import { workspaceOf, guardWorkspacePath, type Workspace } from "./workspace-target.js";
import { renderProgressBar } from "./render-progress.js";
import {
  CHUNK_SECONDS,
  MASTER,
  PIECE_TARGET_LUFS,
  SAMPLE_RATE,
  chunkGraph,
  combineLoudness,
  hoursLabel,
  masterChain,
  planMusic,
  seedFrom,
  type MusicPlan,
  type Piece,
} from "./long-extend-plan.js";

const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = () => process.env.FFPROBE_PATH || "ffprobe";
const AUDIO = new Set([".ogg", ".oga", ".opus", ".mp3", ".wav", ".flac", ".m4a", ".aac"]);
/** Head room the chunks keep, so a crossfade's sum never clips the 24-bit FLAC; the master gives it back. */
const HEADROOM_DB = -6;
const LABEL = /^[a-z0-9][a-z0-9-]*$/;

interface MusicEntry {
  path: string;
  in?: number;
  out?: number;
}

/** Runs a program; resolves with the tail of stderr (ebur128 logs a line per 100 ms) and kills it on abort. */
function run(cmd: string, args: string[], options: { signal?: AbortSignal; onStdout?: (text: string) => void } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("cancelled"));
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let tail = "";
    child.stderr.on("data", (d: Buffer) => {
      tail = (tail + d.toString()).slice(-64 * 1024);
    });
    child.stdout.on("data", (d: Buffer) => options.onStdout?.(d.toString()));
    const abort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => reject(new Error(`${cmd}: ${error.message}`)));
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) return reject(new Error("cancelled"));
      if (code === 0) resolve(tail);
      else reject(new Error(`${basename(cmd)} exited ${code}: ${tail.trim().split("\n").filter(Boolean).slice(-3).join(" | ")}`));
    });
  });
}

/** At most `limit` of the tasks at once, results in order. */
async function pool<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** The summary ebur128 prints when its stream ends. */
function ebur128Summary(stderr: string): { integrated: number; truePeak: number } {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const num = (re: RegExp) => {
    const m = re.exec(summary);
    return m && m[1] !== "-inf" ? Number(m[1]) : Number.NEGATIVE_INFINITY;
  };
  return { integrated: num(/I:\s+(-?[\d.]+|-inf) LUFS/), truePeak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}

async function probe(file: string): Promise<{ duration: number; streams: Array<{ codec_type: string; codec_name: string; duration?: string }> }> {
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(FFPROBE(), ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,duration", "-of", "json", file], { windowsHide: true });
    let text = "";
    child.stdout.on("data", (d: Buffer) => (text += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(text) : reject(new Error(`ffprobe could not read ${file}`))));
  });
  const json = JSON.parse(out) as { format?: { duration?: string }; streams?: Array<{ codec_type: string; codec_name: string; duration?: string }> };
  return { duration: Number(json.format?.duration ?? Number.NaN), streams: json.streams ?? [] };
}

const concatLine = (file: string) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

/** The episode's music when none is named: every audio file in assets/music/. */
function defaultMusic(dir: string): string[] {
  const musicDir = join(dir, "assets", "music");
  const found = existsSync(musicDir) ? readdirSync(musicDir).filter((f) => AUDIO.has(extname(f).toLowerCase())).sort() : [];
  if (found.length > 0) return found.map((f) => `assets/music/${f}`);
  const soundsDir = join(dir, "assets", "sounds");
  const sounds = existsSync(soundsDir) ? readdirSync(soundsDir).filter((f) => AUDIO.has(extname(f).toLowerCase())).sort() : [];
  // Sounds hold ambiences as well as music, and the soundtrack is music only: never guess among them.
  throw new Error(
    "the episode has no assets/music/; name the music pieces with `music`" +
      (sounds.length > 0 ? ` (audio in assets/sounds: ${sounds.join(", ")}; only the music belongs in the soundtrack)` : ""),
  );
}

/** A piece measured: its playable stretch (silent head and tail cut, unless given) and that stretch's loudness. */
async function measurePiece(ws: Workspace, entry: MusicEntry): Promise<Piece> {
  const file = join(ws.dir, entry.path);
  const duration = await audioDuration(file);
  let a = entry.in ?? 0;
  let b = entry.out ?? duration;
  if (entry.in === undefined || entry.out === undefined) {
    const quiet = await silences(file, -50, 0.5);
    if (entry.in === undefined) {
      const head = quiet.find(([s]) => s <= 0.01);
      if (head) a = Math.min(head[1], duration);
    }
    if (entry.out === undefined) {
      const tail = quiet.find(([, e]) => e >= duration - 0.01);
      if (tail) b = Math.max(tail[0], a);
    }
  }
  if (!(b > a) || b > duration + 0.01) throw new Error(`${entry.path}: in/out ${a}–${b} is outside its ${duration.toFixed(1)} s`);
  const measured = await loudness(file, { from: a, to: b });
  return {
    id: basename(entry.path, extname(entry.path)),
    source: entry.path.replace(/\\/g, "/"),
    region: [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000],
    measuredLufs: measured.integrated,
  };
}

export function registerLongExtendTools(pi: ExtensionAPI): void {
  const libraryRoot = () => process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");

  pi.registerTool({
    name: "pva_extend_episode",
    label: "Extend Episode",
    description:
      "Make a long version (0.25–10 hours) of a finished looping episode: the master (default: output/current.json's render) repeated by stream copy, " +
      "under a music-only soundtrack drawn from the given pieces — a seeded order that never plays the same piece twice in a row, whole pieces " +
      "mostly and sometimes long sections, joined by 3–6 s crossfades or 1–3 s gaps, each levelled, mastered to -17 LUFS / -1 dBTP with a 3 s " +
      "fade-in and 6 s fade-out, AAC 192k. Writes output/<label>-<hours>h-<timestamp>.mp4 with .plan.json and .report.json beside it; " +
      "output/current.json does not move. Music defaults to every audio file in assets/music/; ambiences and effects never go in.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      hours: Type.Optional(Type.Number({ minimum: 0.25, maximum: 10, description: "Length in hours (1, 2, 3 … 10); or give durationSeconds" })),
      durationSeconds: Type.Optional(Type.Number({ minimum: 60, maximum: 36000, description: "Length in seconds, instead of hours" })),
      music: Type.Optional(
        Type.Array(
          Type.Union([
            Type.String(),
            Type.Object({
              path: Type.String(),
              in: Type.Optional(Type.Number({ minimum: 0, description: "Where the piece's playable stretch starts, seconds" })),
              out: Type.Optional(Type.Number({ minimum: 0, description: "Where it ends, seconds" })),
            }),
          ]),
          { description: "Music pieces, paths relative to the episode (at least two). Default: every audio file in assets/music/. A silent head and tail are cut unless in/out are given." },
        ),
      ),
      master: Type.Optional(Type.String({ description: "The looping master, relative to the episode. Default: the render output/current.json names" })),
      seed: Type.Optional(Type.Integer({ minimum: 0, description: "Seed of the music order. Default: derived from the episode slug, so a rerun gives the same soundtrack" })),
      label: Type.Optional(Type.String({ default: "long", description: "Lowercase kebab-case label of the output file" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const started = Date.now();
      const timings: Record<string, number> = {};
      let workDir: string | null = null;
      let partial: string | null = null;
      try {
        const lib = libraryRoot();
        const ws = workspaceOf(lib, { channel: params.channel, series: params.series, episode: params.episode });
        if (!existsSync(ws.dir)) throw new Error(`there is no episode ${ws.label}`);
        const guard = async (relative: string) => {
          const check = await guardWorkspacePath(lib, ws, relative);
          if (!check.allowed) throw new Error(check.reason ?? `${relative} is outside the episode`);
          if (!existsSync(join(ws.dir, relative))) throw new Error(`${relative} does not exist in ${ws.label}`);
        };

        if ((params.hours === undefined) === (params.durationSeconds === undefined)) throw new Error("give hours or durationSeconds, one of them");
        const durationSeconds = params.durationSeconds ?? Math.round(params.hours! * 3600 * 1000) / 1000;
        const label = params.label ?? "long";
        if (!LABEL.test(label)) throw new Error(`label "${label}" is not lowercase kebab-case`);

        let masterPath = params.master;
        if (masterPath === undefined) {
          const currentFile = join(ws.dir, "output", "current.json");
          if (!existsSync(currentFile)) throw new Error("the episode has no output/current.json: render it with pva_compose_video, or name the master");
          masterPath = `output/${(JSON.parse(readFileSync(currentFile, "utf8")) as { path: string }).path}`;
        }
        await guard(masterPath);
        const master = await probe(join(ws.dir, masterPath));
        if (!master.streams.some((s) => s.codec_type === "video")) throw new Error(`${masterPath} has no video`);
        if (!(master.duration > 0)) throw new Error(`${masterPath} has no duration`);

        const entries: MusicEntry[] = (params.music ?? defaultMusic(ws.dir)).map((m) => (typeof m === "string" ? { path: m } : m));
        for (const e of entries) {
          await guard(e.path);
          if (!AUDIO.has(extname(e.path).toLowerCase())) throw new Error(`${e.path} is not an audio file`);
        }

        const limit = Math.max(1, Math.floor(cpus().length / 2));
        const bar = renderProgressBar(started);
        const progress = (stage: string, value: number) => {
          const line = bar(value, Date.now());
          if (line) onUpdate?.({ content: [{ type: "text" as const, text: line.replace(/^Rendering/, stage) }], details: { progress: value, stage } });
        };

        // 1. The pieces: playable stretch and loudness.
        let t0 = Date.now();
        progress("Measuring music", 0);
        const pieces = await pool(limit, entries.map((e) => () => measurePiece(ws, e)));
        timings.measureSeconds = (Date.now() - t0) / 1000;

        // 2. The plan.
        const seed = params.seed ?? seedFrom(params.episode);
        const plan: MusicPlan = planMusic(pieces, durationSeconds, seed);

        // 3. The soundtrack, chunk by chunk, in parallel.
        t0 = Date.now();
        workDir = join(ws.dir, "work", `extend-${stamp()}-${process.pid}`);
        mkdirSync(workDir, { recursive: true });
        let done = 0;
        progress("Mixing music", 0.05);
        const measured = await pool(
          limit,
          plan.chunks.map((chunk) => async () => {
            const { inputs, graph } = chunkGraph(plan, chunk, (source) => join(ws.dir, source), HEADROOM_DB);
            const graphFile = join(workDir!, `chunk-${chunk.index}.graph`);
            writeFileSync(graphFile, graph);
            const out = join(workDir!, `chunk-${String(chunk.index).padStart(4, "0")}.flac`);
            const stderr = await run(
              FFMPEG(),
              ["-hide_banner", "-nostats", "-y", ...inputs, "-/filter_complex", graphFile, "-map", "[mix]", "-c:a", "flac", "-sample_fmt", "s32", "-ar", String(SAMPLE_RATE), "-ac", "2", out],
              { signal },
            );
            done += 1;
            progress("Mixing music", 0.05 + 0.5 * (done / plan.chunks.length));
            return { out, seconds: (chunk.endSample - chunk.startSample) / SAMPLE_RATE, ...ebur128Summary(stderr) };
          }),
        );
        timings.mixSeconds = (Date.now() - t0) / 1000;

        // 4. Master and mux: the video looped by stream copy, the soundtrack mastered and encoded once.
        t0 = Date.now();
        const mix = combineLoudness(measured);
        const chain = masterChain(mix, durationSeconds);
        const loops = Math.ceil(durationSeconds / master.duration);
        const videoList = join(workDir, "video.txt");
        const audioList = join(workDir, "audio.txt");
        writeFileSync(videoList, Array.from({ length: loops }, () => concatLine(join(ws.dir, masterPath!))).join("\n") + "\n");
        writeFileSync(audioList, measured.map((m) => concatLine(m.out)).join("\n") + "\n");
        const outDir = join(ws.dir, "output");
        const base = `${label}-${hoursLabel(durationSeconds)}h-${stamp()}`;
        const output = join(outDir, `${base}.mp4`);
        partial = join(outDir, `${base}.partial.mp4`);
        progress("Muxing", 0.55);
        let buffered = "";
        await run(
          FFMPEG(),
          [
            "-hide_banner", "-nostats", "-y", "-progress", "pipe:1",
            "-f", "concat", "-safe", "0", "-i", videoList,
            "-f", "concat", "-safe", "0", "-i", audioList,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy",
            "-af", chain.filter, "-c:a", MASTER.codec, "-b:a", MASTER.bitrate, "-ar", String(SAMPLE_RATE), "-ac", "2",
            "-t", String(durationSeconds), "-movflags", "+faststart", "-f", "mp4", partial,
          ],
          {
            signal,
            onStdout(text) {
              buffered += text;
              const lines = buffered.split("\n");
              buffered = lines.pop() ?? "";
              for (const line of lines) {
                const m = /^out_time_us=(\d+)/.exec(line);
                if (m) progress("Muxing", 0.55 + 0.4 * Math.min(1, Number(m[1]) / 1e6 / durationSeconds));
              }
            },
          },
        );
        renameSync(partial, output);
        partial = null;
        timings.muxSeconds = (Date.now() - t0) / 1000;

        // 5. Verify: the duration of the file and of its streams, and the loudness that reached it.
        t0 = Date.now();
        const result = await probe(output);
        const streamDurations = result.streams.map((s) => Number(s.duration)).filter(Number.isFinite);
        const off = Math.max(Math.abs(result.duration - durationSeconds), ...streamDurations.map((d) => Math.abs(d - durationSeconds)));
        const segments = Array.from({ length: Math.ceil(durationSeconds / CHUNK_SECONDS) }, (_, k) => ({
          from: k * CHUNK_SECONDS,
          seconds: Math.min(CHUNK_SECONDS, durationSeconds - k * CHUNK_SECONDS),
        }));
        let verified = 0;
        const final = combineLoudness(
          await pool(
            limit,
            segments.map((s) => async () => {
              const stderr = await run(FFMPEG(), ["-hide_banner", "-nostats", "-ss", String(s.from), "-t", String(s.seconds), "-i", output, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { signal });
              verified += 1;
              progress("Verifying", 0.95 + 0.05 * (verified / segments.length));
              return { seconds: s.seconds, ...ebur128Summary(stderr) };
            }),
          ),
        );
        timings.verifySeconds = (Date.now() - t0) / 1000;
        timings.totalSeconds = (Date.now() - started) / 1000;

        const sizeBytes = statSync(output).size;
        const concerns = [
          ...(off > 0.1 ? [`duration is ${result.duration.toFixed(3)} s, ${off.toFixed(3)} s from ${durationSeconds} s`] : []),
          ...(Math.abs(final.integrated - MASTER.lufs) > 1 ? [`loudness ${final.integrated.toFixed(1)} LUFS, target ${MASTER.lufs}`] : []),
          ...(final.truePeak > MASTER.truePeak ? [`true peak ${final.truePeak.toFixed(1)} dBTP, above ${MASTER.truePeak}`] : []),
        ];

        const episodeRef = `${params.channel}/${params.series}/${params.episode}`;
        writeFileSync(
          join(outDir, `${base}.plan.json`),
          JSON.stringify(
            {
              apiVersion: "studio.video/v1alpha1",
              kind: "MusicBedPlan",
              episode: episodeRef,
              seed,
              durationSeconds,
              rule: "music only, no sound effects or ambiences",
              generator: `pva_extend_episode (ffmpeg, ${CHUNK_SECONDS} s chunks placed by absolute sample; pieces levelled to ${PIECE_TARGET_LUFS} LUFS; master: gain to ${MASTER.lufs} LUFS, limiter if needed, fade-in ${MASTER.fadeIn} s / fade-out ${MASTER.fadeOut} s)`,
              master: { path: masterPath, durationSeconds: master.duration, loops },
              pieces: Object.fromEntries(pieces.map((p) => [p.id, { source: p.source, region: p.region, measuredLufs: p.measuredLufs, targetLufs: PIECE_TARGET_LUFS, occurrences: plan.occurrences[p.id] }])),
              materialSeconds: Math.round(pieces.reduce((s, p) => s + p.region[1] - p.region[0], 0) * 10) / 10,
              clips: plan.clips,
              chunks: plan.chunks.map((c) => ({ index: c.index, startSample: c.startSample, endSample: c.endSample, clips: c.clips.length })),
            },
            null,
            1,
          ),
        );
        const report = {
          apiVersion: "studio.video/v1alpha1",
          kind: "LongVersionReport",
          episode: episodeRef,
          file: `output/${base}.mp4`,
          durationSeconds: result.duration,
          requestedSeconds: durationSeconds,
          sizeBytes,
          video: { master: masterPath, loops, codec: "copy" },
          audio: { mixLufs: mix.integrated, mixTruePeak: mix.truePeak, masterGainDb: chain.gainDb, limiter: chain.limiter, integratedLufs: final.integrated, truePeakDbtp: final.truePeak, codec: `${MASTER.codec} ${MASTER.bitrate}` },
          clips: plan.clips.length,
          chunks: plan.chunks.length,
          parallelism: limit,
          timings,
          concerns,
          createdAt: new Date().toISOString(),
        };
        writeFileSync(join(outDir, `${base}.report.json`), JSON.stringify(report, null, 2));

        const counts = Object.entries(plan.occurrences).map(([k, v]) => `${k}×${v}`).join(", ");
        const lines = [
          `${concerns.length === 0 ? "✅" : "⚠️"} output/${base}.mp4 — ${result.duration.toFixed(2)} s (${hoursLabel(durationSeconds)} h), ${(sizeBytes / 1024 ** 3).toFixed(2)} GB; ` +
            `${final.integrated.toFixed(1)} LUFS, true peak ${final.truePeak.toFixed(1)} dBTP`,
          `video: ${masterPath} looped ${loops}× by stream copy; music: ${plan.clips.length} clips from ${pieces.length} pieces (${counts}), seed ${seed}`,
          `took ${clock(timings.totalSeconds * 1000)}: measure ${clock(timings.measureSeconds * 1000)}, mix ${clock(timings.mixSeconds * 1000)} (${plan.chunks.length} chunks, ${limit} at once), ` +
            `mux ${clock(timings.muxSeconds * 1000)}, verify ${clock(timings.verifySeconds * 1000)}`,
          `plan and report: output/${base}.plan.json, output/${base}.report.json (current.json unchanged)`,
          ...concerns.map((c) => `- ${c}`),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: report as unknown as Record<string, unknown> };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `❌ ${error instanceof Error ? error.message : String(error)}` }],
          details: {} as Record<string, unknown>,
          isError: true as unknown as boolean,
        };
      } finally {
        if (partial) rmSync(partial, { force: true });
        if (workDir) {
          rmSync(workDir, { recursive: true, force: true });
          // work/ was made for this run: leave no empty directory behind.
          const parent = join(workDir, "..");
          if (existsSync(parent) && readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true });
        }
      }
    },
  });
}
