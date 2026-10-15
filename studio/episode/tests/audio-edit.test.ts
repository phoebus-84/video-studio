import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAudioEdit } from "@studio/contracts/src/audio-edits.mjs";
import { editAudio, editRecordFor, resolveEdit, type EditRecipe } from "../src/audio-edit.js";
import { alignTake } from "../src/take-align.js";
import { registerTake } from "../src/take-register.js";
import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";

/**
 * Audio editing in a workspace (avg-8hs.5), on synthetic takes: each "word"
 * a 0.3 s tone, the pauses silence with a faint room tone, the timing exact.
 */

let ws: string;
beforeEach(() => { ws = mkdtempSync(join(tmpdir(), "audio-edit-ws-")); });
afterEach(() => rmSync(ws, { recursive: true, force: true }));
const sha = (b: Buffer | string) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

/** A take saying `words` at `freq`, each 0.3 s, with these pauses between them; registered with its timing. */
function take(id: string, words: string[], freq: number, pauses: number[], takes: any[] = []) {
  mkdirSync(join(ws, "assets/takes"), { recursive: true });
  mkdirSync(join(ws, "artifacts/timing"), { recursive: true });
  const timed: { text: string; start: number; end: number }[] = [];
  const parts: string[] = [];
  let t = 0.2;
  parts.push(`0.2`);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  words.forEach((w, i) => {
    timed.push({ text: w, start: r3(t), end: r3(t + 0.3) });
    t = r3(t + 0.3);
    if (i < words.length - 1) t = r3(t + pauses[i]!);
  });
  const total = r3(t + 0.3);
  // Tone where a word is, a faint noise floor everywhere else.
  const expr = timed.map((w) => `between(t,${w.start},${w.end})`).join("+");
  const file = join(ws, "assets/takes", `${id}.wav`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=exprs='0.3*sin(2*PI*${freq}*t)*(${expr})+0.002*sin(2*PI*97*t)':s=48000:d=${total}`, "-ac", "1", file]);
  const audio = { path: `assets/takes/${id}.wav`, hash: sha(readFileSync(file)), durationSeconds: total };
  const timing = { apiVersion: "studio.video/v1alpha1", kind: "WordTiming", take: { id }, audio, text: words.join(" "), language: "it", alignment: { provider: "test", method: "forced", createdAt: "2026-10-14T00:00:00Z" }, words: timed };
  const timingText = `${JSON.stringify(timing)}\n`;
  writeFileSync(join(ws, `artifacts/timing/${id}.json`), timingText);
  takes.push({ id, audio, text: words.join(" "), language: "it", voice: { provider: "test" }, timing: { path: `artifacts/timing/${id}.json`, hash: sha(timingText) } });
  mkdirSync(join(ws, "artifacts/narration"), { recursive: true });
  writeFileSync(join(ws, "artifacts/narration/takes.json"), JSON.stringify({ apiVersion: "studio.video/v1alpha1", kind: "NarrationTakes", takes, units: [] }));
  return { timed, takes };
}

const pcm = (rel: string, from: number, seconds: number) => {
  const buf = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(from), "-t", String(seconds), "-i", join(ws, rel), "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
};
const freq = (x: Float32Array) => { let c = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) c++; return c / 2 / (x.length / 48000); };

describe("montage of two takes", () => {
  it("joins the start of one take to the end of the other on words, carrying their words", async () => {
    const words = ["uno", "due", "tre", "quattro"];
    const { takes } = take("a", words, 440, [0.4, 0.4, 0.4]);
    take("b", words, 660, [0.5, 0.5, 0.5], takes);
    const recipe: EditRecipe = { output: { path: "assets/takes/recita.wav" }, tracks: [{ id: "voice", clips: [
      { id: "a", source: { take: "a" }, out: { word: "due", edge: "end" }, at: 0 },
      { id: "b", source: { take: "b" }, in: { word: "tre", edge: "start" }, at: "after", crossfade: 0.02 },
    ] }] };
    const { record, recordPath } = await editAudio(ws, recipe);
    expect(record.words!.map((w) => w.text)).toEqual(words);
    // «uno» and «due» from take a, «tre» and «quattro» from take b.
    expect(freq(pcm("assets/takes/recita.wav", record.words![1]!.start + 0.05, 0.2))).toBeCloseTo(440, -1);
    expect(freq(pcm("assets/takes/recita.wav", record.words![2]!.start + 0.05, 0.2))).toBeCloseTo(660, -1);
    // The cuts fell in the pauses, not in a word.
    const [a, b] = record.placements;
    expect(a!.out).toBeGreaterThan(0.2 + 0.3 + 0.4 + 0.3);
    expect(a!.out).toBeLessThan(0.2 + 0.3 + 0.4 + 0.3 + 0.4);
    expect(b!.in).toBeGreaterThan(0.2 + 0.3 + 0.5 + 0.3);
    expect(record.report.joins[0]!.click).toBe(false);
    expect(validateAudioEdit(JSON.parse(readFileSync(join(ws, recordPath), "utf-8")))).toEqual([]);
    expect(existsSync(join(ws, "assets/takes/recita.wav.peaks.json"))).toBe(true);
    expect(editRecordFor(ws, record.output.hash)?.path).toBe(recordPath);
  });
});

describe("an edited take", () => {
  it("registers like any take and takes its timing from the edit, with no new alignment", async () => {
    const words = ["uno", "due", "tre", "quattro"];
    const { takes } = take("a", words, 440, [0.4, 0.4, 0.4]);
    take("b", words, 660, [0.5, 0.5, 0.5], takes);
    const { record } = await editAudio(ws, { output: { path: "assets/takes/montata.wav" }, tracks: [{ id: "voice", clips: [
      { id: "a", source: { take: "a" }, out: { word: "due", edge: "end" }, at: 0 },
      { id: "b", source: { take: "b" }, in: { word: "tre", edge: "start" }, at: "after", crossfade: 0.02 },
    ] }], pauses: [{ take: "b", after: "tre", seconds: 0.9 }] });
    await registerTake(ws, { take: "recita", audio: "assets/takes/montata.wav", text: words.join(" "), language: "it", voice: { provider: "audio-edit", settings: { record: "assets/takes/montata.wav.edit.json" } } });
    const aligned = await alignTake(ws, { take: "recita", provider: "derived" });
    expect(aligned.timing.alignment).toMatchObject({ provider: "audio-edit", method: "derived", model: "assets/takes/montata.wav.edit.json" });
    expect(aligned.timing.words.map((w: { text: string }) => w.text)).toEqual(words);
    expect(validateWordTiming(aligned.timing, { audioHash: record.output.hash })).toEqual([]);
    // The reshaped pause is in the timing: «quattro» comes 0.9 s after «tre».
    const w = aligned.timing.words as { start: number; end: number }[];
    expect(w[3]!.start - w[2]!.end).toBeCloseTo(0.9, 1);
  });

  it("says when no edit made a take's audio", async () => {
    const { takes } = take("a", ["uno", "due"], 440, [0.4]);
    expect(takes.length).toBe(1);
    await expect(alignTake(ws, { take: "a", provider: "derived" })).rejects.toMatchObject({ code: "no-edit" });
  });
});

describe("pauses", () => {
  it("lengthens a pause with the take's room tone, and carries the words after it later by as much", async () => {
    const words = ["la", "nebbia", "sale"];
    const { timed } = take("r", words, 330, [0.3, 0.3]);
    const plain = await editAudio(ws, { output: { path: "assets/takes/plain.wav" }, tracks: [{ id: "v", clips: [{ id: "r", source: { take: "r" }, at: 0 }] }] });
    const long = await editAudio(ws, { output: { path: "assets/takes/long.wav" }, tracks: [{ id: "v", clips: [{ id: "r", source: { take: "r" }, at: 0 }] }], pauses: [{ take: "r", after: "nebbia", seconds: 0.8 }] });
    expect(long.record.output.durationSeconds - plain.record.output.durationSeconds).toBeCloseTo(0.5, 2);
    expect(long.record.words![2]!.start - timed[2]!.start).toBeCloseTo(0.5, 2);
    expect(long.record.words![1]!.start).toBeCloseTo(timed[1]!.start, 3);
    // The inserted time is the room's quiet, not a tone.
    const gap = pcm("assets/takes/long.wav", long.record.words![1]!.end + 0.1, 0.5);
    expect(Math.max(...gap.map(Math.abs))).toBeLessThan(0.02);
    expect(long.record.report.joins.every((j) => !j.click)).toBe(true);
    expect(long.record.pauses).toEqual([{ take: "r", word: "nebbia", before: 0.3, after: 0.8, at: expect.any(Number) }]);
    expect(long.record.pauses![0]!.at).toBeGreaterThan(long.record.words![1]!.end);
    expect(long.record.pauses![0]!.at).toBeLessThan(long.record.words![2]!.start);
  });

  it("shortens a pause, never closer than 40 ms to a word, and says when it cannot go further", async () => {
    take("r", ["la", "nebbia", "sale"], 330, [0.6, 0.3]);
    const short = await editAudio(ws, { output: { path: "assets/takes/short.wav" }, tracks: [{ id: "v", clips: [{ id: "r", source: { take: "r" }, at: 0 }] }], pauses: [{ take: "r", after: "la", seconds: 0.3 }] });
    expect(short.record.words![1]!.start - short.record.words![0]!.end).toBeCloseTo(0.3, 2);
    const tooShort = await editAudio(ws, { output: { path: "assets/takes/tight.wav" }, tracks: [{ id: "v", clips: [{ id: "r", source: { take: "r" }, at: 0 }] }], pauses: [{ take: "r", after: "la", seconds: 0 }] });
    expect(tooShort.record.words![1]!.start - tooShort.record.words![0]!.end).toBeGreaterThanOrEqual(0.07);
    expect(tooShort.record.report.concerns.join("\n")).toMatch(/can only shrink/);
  });
});

describe("review fixes", () => {
  it("keeps a clip's gain on every piece a pause makes, its fade-out on the last, and no false jumps at the splices", async () => {
    take("r", ["la", "nebbia", "sale"], 330, [0.3, 0.3]);
    const plain = await editAudio(ws, { output: { path: "assets/takes/p.wav" }, tracks: [{ id: "v", clips: [{ id: "c", source: { take: "r" }, at: 0, gain: -12, fadeOut: 0.2 }] }] });
    const paused = await editAudio(ws, { output: { path: "assets/takes/q.wav" }, tracks: [{ id: "v", clips: [{ id: "c", source: { take: "r" }, at: 0, gain: -12, fadeOut: 0.2 }] }], pauses: [{ take: "r", after: "nebbia", seconds: 0.9 }] });
    // «sale», after the pause, at the same level as without it.
    const level = (rel: string, from: number) => { const x = pcm(rel, from, 0.2); let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length); };
    expect(level("assets/takes/q.wav", paused.record.words![2]!.start + 0.02) - level("assets/takes/p.wav", plain.record.words![2]!.start + 0.02)).toBeCloseTo(0, 0);
    expect(paused.record.report.concerns).toEqual([]);
    const placed = paused.record.placements.filter((p) => p.track === "v");
    expect(placed[0]!.fadeOut).toBe(0.012);
    expect(placed[placed.length - 1]!.fadeOut).toBe(0.2);
  });

  it("says when a pause reshapes nothing, and never writes over a take it reads", async () => {
    take("r", ["la", "nebbia", "sale"], 330, [0.3, 0.3]);
    const none = await editAudio(ws, { output: { path: "assets/takes/n.wav" }, tracks: [{ id: "v", clips: [{ id: "c", source: { take: "r" }, out: { word: "la", edge: "end" }, at: 0 }] }], pauses: [{ take: "r", after: "nebbia", seconds: 0.9 }] });
    expect(none.record.report.concerns.join("\n")).toMatch(/the pause after «nebbia» .* is in no clip/);
    await expect(editAudio(ws, { output: { path: "assets/takes/r.wav" }, tracks: [{ id: "v", clips: [{ id: "c", source: { take: "r" }, at: 0 }] }] })).rejects.toMatchObject({ code: "bad-recipe" });
  });

  it("names a stale timing and changed audio for what they are", async () => {
    take("r", ["la", "nebbia"], 330, [0.3]);
    const code = async () => { try { await resolveEdit(ws, { output: { path: "assets/takes/x.wav" }, tracks: [{ id: "v", clips: [{ id: "c", source: { take: "r" }, out: { word: "la", edge: "end" }, at: 0 }] }] }); } catch (e) { return (e as { code: string }).code; } return "ok"; };
    writeFileSync(join(ws, "artifacts/timing/r.json"), "{}\n");
    expect(await code()).toBe("stale-timing");
    writeFileSync(join(ws, "assets/takes/r.wav"), "another take");
    expect(await code()).toBe("audio-changed");
  });
});

describe("refusals", () => {
  it("names what it cannot find, where", async () => {
    take("r", ["e", "cielo", "e", "terra"], 330, [0.3, 0.3, 0.3]);
    const code = async (recipe: EditRecipe) => { try { await resolveEdit(ws, recipe); } catch (e) { return `${(e as { code?: string }).code} ${(e as { path?: string }).path ?? ""}`.trim(); } return "ok"; };
    const one = (clip: Partial<EditRecipe["tracks"][0]["clips"][0]>, output = "assets/takes/x.wav") => ({ output: { path: output }, tracks: [{ id: "v", clips: [{ id: "c", source: { take: "r" }, at: 0, ...clip }] }] }) as EditRecipe;
    expect(await code(one({ source: { take: "nobody" } }))).toBe("no-such-take $.tracks[0].clips[0].source");
    expect(await code(one({ out: { word: "mare", edge: "end" } }))).toBe("no-such-word $.tracks[0].clips[0].out");
    expect(await code(one({ out: { word: "e", edge: "end" } }))).toBe("no-such-word $.tracks[0].clips[0].out");
    expect(await code(one({ out: { word: "e", occurrence: 2, edge: "end" } }))).toBe("ok");
    expect(await code(one({}, "../escape.wav"))).toBe("bad-recipe $.output.path");
    expect(await code(one({ source: { path: "../../etc/hosts" } }))).toBe("bad-recipe $.tracks[0].clips[0].source");
  });
});
