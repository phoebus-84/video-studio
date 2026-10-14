// Rendering a recipe. Pass one: the graph's mix, 32-bit float, to a work file.
// Then, measured on that mix: the head and tail trimmed to the silence the
// master keeps, the loudness brought to target (EBU R128 measured, then exactly
// that gain; a limiter only when the gain would push the true peak over the
// ceiling, and the report says so),
// the true peak held, the edges faded, and the file written bit-exact. The
// report says where every clip went and what the joins sound like.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
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
  if (rel.startsWith("..") || isAbsolute(rel)) throw new AudioEditError("missing-source", `${source} is not inside ${root}`);
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

export async function renderRecipe(recipe: Recipe, options: { root: string; output: string }): Promise<RenderResult> {
  const ext = extname(options.output).toLowerCase();
  if (!CODECS[ext]) throw new AudioEditError("bad-recipe", `$.output: ${ext || "no extension"} is not a format written here (${Object.keys(CODECS).join(", ")})`);
  const sampleRate = recipe.output.sampleRate ?? 48000;
  const channels = recipe.output.channels ?? 1;
  const sources = [...new Set(recipe.tracks.flatMap((t) => t.clips.map((c) => c.source)))];
  const durations: Record<string, number> = {};
  const files: Record<string, string> = {};
  for (const s of sources) {
    files[s] = sourcePath(options.root, s);
    durations[s] = await audioDuration(files[s]!);
  }
  const placed = place(recipe, durations);
  const graph = buildGraph(recipe, placed, (s) => files[s]!);
  const work = mkdtempSync(join(tmpdir(), "audio-edit-"));
  try {
    // ── Pass one: the mix ──────────────────────────────────────────────────
    const mix = join(work, "mix.wav");
    const master = recipe.master ?? {};
    const gain = master.gain ? [`volume=${master.gain}dB`] : [];
    await ffmpeg([
      ...graph.inputs.flatMap((f) => ["-i", f]),
      "-filter_complex", `${graph.filter};[${graph.out}]${["anull", ...gain].join(",")},atrim=end=${graph.duration}[m]`,
      "-map", "[m]", "-ac", String(channels), "-ar", String(sampleRate), "-c:a", "pcm_f32le", mix,
    ]);
    // ── The window kept: silence trimmed to what the master keeps ──────────
    const total = graph.duration;
    let from = 0;
    let to = total;
    if (master.trim && (master.trim.head !== undefined || master.trim.tail !== undefined)) {
      const quiet = await silences(mix, -50, 0.05);
      const lead = quiet.find(([s]) => s <= 0.001);
      const tail = quiet.find(([, e]) => e === Number.POSITIVE_INFINITY || e >= total - 0.001);
      if (lead && master.trim.head !== undefined) from = Math.max(0, Math.min(lead[1], total) - master.trim.head);
      if (tail && master.trim.tail !== undefined) to = Math.min(total, tail[0] + master.trim.tail);
      if (to <= from) throw new AudioEditError("bad-audio", "the mix is silent: nothing would remain after trimming");
    }
    const length = to - from;
    // ── Loudness, true peak, fades ─────────────────────────────────────────
    const steps: string[] = [`atrim=start=${from}:end=${to}`, "asetpts=PTS-STARTPTS"];
    let normalization: RenderResult["normalization"] = "none";
    const tp = master.truePeak ?? (master.loudness !== undefined ? -1 : undefined);
    if (master.loudness !== undefined) {
      // A gain, measured: what the mix lacks to reach the target. A limiter only if that gain would push the true peak over the ceiling.
      const measured = await loudness(mix, { from, to });
      if (!Number.isFinite(measured.integrated)) throw new AudioEditError("bad-audio", "the mix is silent: its loudness cannot be measured");
      const gainDb = master.loudness - measured.integrated;
      steps.push(`volume=${Math.round(gainDb * 1000) / 1000}dB`);
      normalization = "gain";
      if (tp !== undefined && measured.truePeak + gainDb > tp) {
        // alimiter holds sample peaks: keep half a dB for the peaks between samples.
        steps.push(`alimiter=limit=${Math.pow(10, (tp - 0.5) / 20)}:level=disabled:attack=1:release=50`);
        normalization = "gain+limiter";
      }
    } else if (tp !== undefined) {
      steps.push(`alimiter=limit=${Math.pow(10, (tp - 0.5) / 20)}:level=disabled:attack=1:release=50`);
    }
    if (master.fadeIn) steps.push(`afade=t=in:st=0:d=${Math.min(master.fadeIn, length)}:curve=qsin`);
    if (master.fadeOut) steps.push(`afade=t=out:st=${Math.max(0, length - master.fadeOut)}:d=${Math.min(master.fadeOut, length)}:curve=qsin`);
    const out = join(work, `out${ext}`);
    await ffmpeg(["-i", mix, "-af", steps.join(","), "-ac", String(channels), "-ar", String(sampleRate), ...CODECS[ext]!, "-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1", out]);
    // ── Measured, then put in place ────────────────────────────────────────
    const placements = placed.map((p) => ({ ...p, start: Math.round((p.start - from) * 1e6) / 1e6, end: Math.round((p.end - from) * 1e6) / 1e6 }));
    const [scanned, loud] = await Promise.all([scan(out, { sampleRate, channels }), loudness(out)]);
    const joins = await joinReport(out, placements, sampleRate);
    const concerns: string[] = [];
    if (scanned.clipped > 0) concerns.push(`${scanned.clipped} samples clip: lower a gain, or set master.truePeak`);
    if (master.loudness !== undefined && Math.abs(loud.integrated - master.loudness) > 1) concerns.push(`loudness ${loud.integrated} LUFS, not the ${master.loudness} asked`);
    if (normalization === "gain+limiter") concerns.push("reaching the loudness needed a limiter on the peaks: listen to the loudest moments, or lower the target");
    for (const j of joins) {
      if (j.click) concerns.push(`a click at ${j.at.toFixed(3)} s (${j.track}: ${j.before} → ${j.after}): lengthen the crossfade there`);
      if (j.jumpDb !== null && Math.abs(j.jumpDb) > 6) concerns.push(`a ${j.jumpDb > 0 ? "rise" : "drop"} of ${Math.abs(j.jumpDb).toFixed(1)} dB at ${j.at.toFixed(3)} s (${j.track}: ${j.before} → ${j.after}): match the clips' gains if it is not meant`);
    }
    for (const p of placements) if (p.start < -1e-6 || p.end > length + 1e-3) concerns.push(`${p.track}/${p.clip} is partly trimmed away by the master's trim`);
    mkdirFor(options.output);
    renameOrCopy(out, options.output);
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

function mkdirFor(file: string) {
  mkdirSync(dirname(file), { recursive: true });
}

function renameOrCopy(from: string, to: string) {
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
  }
}
