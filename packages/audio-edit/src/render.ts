// Rendering a recipe. Pass one: the graph's mix, 32-bit float, to a work file.
// Then, measured on that mix: the head and tail trimmed to the silence the
// master keeps, the loudness brought to target (EBU R128 measured, then exactly
// that gain; a limiter only when the gain would push the true peak over the
// ceiling, and the report says so),
// the true peak held, the edges faded, and the file written bit-exact. The
// report says where every clip went and what the joins sound like.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loudness, scan, silences, type Loudness } from "./analyze.js";
import { AudioEditError } from "./errors.js";
import { buildGraph } from "./graph.js";
import { audioDuration, FFMPEG, run } from "./media.js";
import { place } from "./place.js";
import { joinReport, type JoinReport } from "./report.js";
import type { Placement, Recipe } from "./types.js";

const CODECS: Record<string, string[]> = {
  ".wav": ["-c:a", "pcm_s24le"],
  ".flac": ["-c:a", "flac"],
  ".m4a": ["-c:a", "aac", "-b:a", "256k"],
  ".mp3": ["-c:a", "libmp3lame", "-b:a", "256k"],
  ".ogg": ["-c:a", "libvorbis", "-q:a", "8"],
};

export interface RenderResult {
  path: string;
  sha256: string;
  durationSeconds: number;
  /** Every clip where it went, on the output (head trim already subtracted). */
  placements: Placement[];
  /** Seconds removed from the head of the mix: subtract from a clip's mix time to get the output's. */
  headTrim: number;
  loudness: Loudness;
  /** How the loudness was reached: a gain alone, or a gain then a limiter holding the true peak. */
  normalization: "none" | "gain" | "gain+limiter";
  clipped: number;
  joins: JoinReport[];
  /** What a person should check, in plain words. */
  concerns: string[];
}

/** A source inside the root, links followed; `missing-source` otherwise. */
export function sourcePath(root: string, source: string): string {
  const full = isAbsolute(source) ? source : resolve(root, source);
  if (!existsSync(full)) throw new AudioEditError("missing-source", `${source} is not there`);
  const real = realpathSync(full);
  const base = realpathSync(root);
  const rel = relative(base, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new AudioEditError("missing-source", `${source} is not inside ${root}`);
  return real;
}

async function ffmpeg(args: string[]): Promise<string> {
  try {
    const { stderr } = await run(FFMPEG(), ["-hide_banner", "-nostats", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
    return stderr;
  } catch (error) {
    const text = String((error as { stderr?: string }).stderr ?? (error as Error).message);
    throw new AudioEditError("ffmpeg-failed", text.split("\n").filter(Boolean).slice(-3).join(" | "));
  }
}

/** The shortest stretch EBU R128 can give an integrated loudness for. */
const MIN_LOUDNESS_SECONDS = 0.4;

export async function renderRecipe(recipe: Recipe, options: { root: string; output: string }): Promise<RenderResult> {
  const ext = extname(options.output).toLowerCase();
  if (!CODECS[ext]) throw new AudioEditError("bad-recipe", `$.output: ${ext || "no extension"} is not a format written here (${Object.keys(CODECS).join(", ")})`);
  const sampleRate = recipe.output.sampleRate ?? 48000;
  const channels = recipe.output.channels ?? 1;
  if ((ext === ".mp3") && sampleRate > 48000) throw new AudioEditError("bad-recipe", "$.output.sampleRate: mp3 carries at most 48000 Hz");
  const sources = [...new Set(recipe.tracks.flatMap((t) => t.clips.map((c) => c.source)))];
  const durations: Record<string, number> = {};
  const files: Record<string, string> = {};
  for (const s of sources) {
    files[s] = sourcePath(options.root, s);
    durations[s] = await audioDuration(files[s]!);
  }
  const placed = place(recipe, durations);
  const work = mkdtempSync(join(tmpdir(), "audio-edit-"));
  /** One graph to a float work file; the graph read from a file, never the command line (its length is bounded). */
  const renderGraph = async (graphRecipe: Recipe, graphPlacements: Placement[], tail: string, file: string) => {
    const graph = buildGraph(graphRecipe, graphPlacements, (s) => files[s]!);
    const script = join(work, `${file}.graph`);
    writeFileSync(script, `${graph.filter};[${graph.out}]${tail},atrim=end=${graph.duration}[m]`);
    const out = join(work, file);
    await ffmpeg([...graph.inputs.flatMap((f) => ["-i", f]), "-/filter_complex", script, "-map", "[m]", "-ac", String(channels), "-ar", String(sampleRate), "-c:a", "pcm_f32le", out]);
    return out;
  };
  try {
    // ── Pass one: the mix ──────────────────────────────────────────────────
    const master = recipe.master ?? {};
    const mix = await renderGraph(recipe, placed, ["anull", ...(master.gain ? [`volume=${master.gain}dB`] : [])].join(","), "mix.wav");
    const total = await audioDuration(mix);
    // ── The window kept: silence trimmed to what the master keeps ──────────
    let from = 0;
    let to = total;
    if (master.trim && (master.trim.head !== undefined || master.trim.tail !== undefined)) {
      const quiet = await silences(mix, -50, 0.05);
      const lead = quiet.find(([s]) => s <= 0.001);
      const tail = quiet.find(([, e]) => e === Number.POSITIVE_INFINITY || e >= total - 0.02);
      if (lead && master.trim.head !== undefined) from = Math.max(0, Math.min(lead[1], total) - master.trim.head);
      if (tail && master.trim.tail !== undefined) to = Math.min(total, tail[0] + master.trim.tail);
      if (to <= from) throw new AudioEditError("bad-audio", "the mix is silent: nothing would remain after trimming");
    }
    const length = to - from;
    // ── Loudness, true peak, fades ─────────────────────────────────────────
    const concerns: string[] = [];
    const steps: string[] = [`atrim=start=${from}:end=${to}`, "asetpts=PTS-STARTPTS"];
    let normalization: RenderResult["normalization"] = "none";
    const tp = master.truePeak ?? (master.loudness !== undefined ? -1 : undefined);
    const limiter = () => steps.push(`alimiter=limit=${Math.pow(10, (tp! - 0.5) / 20)}:level=disabled:attack=1:release=50`);
    if (master.loudness !== undefined) {
      // A gain, measured: what the mix lacks to reach the target. A limiter only if that gain would push the true peak over the ceiling.
      const measured = length >= MIN_LOUDNESS_SECONDS ? await loudness(mix, { from, to }) : null;
      if (!measured || !Number.isFinite(measured.integrated) || measured.integrated <= -69.9) {
        concerns.push(`the mix is too short to measure its loudness (${length.toFixed(2)} s; EBU R128 needs ${MIN_LOUDNESS_SECONDS} s of sound): no gain applied`);
        if (tp !== undefined) limiter();
      } else {
        const gainDb = master.loudness - measured.integrated;
        steps.push(`volume=${Math.round(gainDb * 1000) / 1000}dB`);
        normalization = "gain";
        if (tp !== undefined && measured.truePeak + gainDb > tp) {
          limiter();
          normalization = "gain+limiter";
        }
      }
    } else if (tp !== undefined) {
      limiter();
    }
    if (master.fadeIn) steps.push(`afade=t=in:st=0:d=${Math.min(master.fadeIn, length)}:curve=qsin`);
    if (master.fadeOut) steps.push(`afade=t=out:st=${Math.max(0, length - master.fadeOut)}:d=${Math.min(master.fadeOut, length)}:curve=qsin`);
    // Written beside the output, then renamed: never a half-written file under its name.
    mkdirSync(dirname(options.output), { recursive: true });
    const partial = join(dirname(options.output), `.${basename(options.output)}.${process.pid}.partial${ext}`);
    try {
      await ffmpeg(["-i", mix, "-af", steps.join(","), "-ac", String(channels), "-ar", String(sampleRate), ...CODECS[ext]!, "-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1", partial]);
      renameSync(partial, options.output);
    } finally {
      rmSync(partial, { force: true });
    }
    // ── Measured ───────────────────────────────────────────────────────────
    const shift = (p: Placement) => ({ ...p, start: Math.round((p.start - from) * 1e6) / 1e6, end: Math.round((p.end - from) * 1e6) / 1e6 });
    const placements = placed.map(shift);
    const [scanned, loud] = await Promise.all([scan(options.output, { sampleRate, channels }), loudness(options.output)]);
    // Joins measured on each track alone: another track never masks a drop, nor a gap fakes one.
    const joins: JoinReport[] = [];
    for (const track of recipe.tracks) {
      const own = placed.filter((p) => p.track === track.id);
      if (own.length < 2) continue;
      const stem = await renderGraph({ ...recipe, tracks: [{ ...track, duck: undefined }] }, own, "anull", `stem-${track.id}.wav`);
      joins.push(...(await joinReport(stem, own, sampleRate)).map((j) => ({ ...j, at: Math.round((j.at - from) * 1e6) / 1e6 })));
    }
    if (scanned.clipped > 0) concerns.push(`${scanned.clipped} samples clip: lower a gain, or set master.truePeak`);
    if (normalization !== "none" && master.loudness !== undefined && Math.abs(loud.integrated - master.loudness) > 1) concerns.push(`loudness ${loud.integrated} LUFS, not the ${master.loudness} asked`);
    if (normalization === "gain+limiter") concerns.push("reaching the loudness needed a limiter on the peaks: listen to the loudest moments, or lower the target");
    for (const j of joins) {
      if (j.click) concerns.push(`a click at ${j.at.toFixed(3)} s (${j.track}: ${j.before} → ${j.after}): lengthen the crossfade there`);
      if (j.jumpDb !== null && Math.abs(j.jumpDb) > 6) concerns.push(`a ${j.jumpDb > 0 ? "rise" : "drop"} of ${Math.abs(j.jumpDb).toFixed(1)} dB at ${j.at.toFixed(3)} s (${j.track}: ${j.before} → ${j.after}): match the clips' gains if it is not meant`);
    }
    const bytes = readFileSync(options.output);
    return {
      path: options.output, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      durationSeconds: scanned.durationSeconds, placements, headTrim: Math.round(from * 1e6) / 1e6,
      loudness: loud, normalization, clipped: scanned.clipped, joins, concerns,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
