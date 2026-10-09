// ---------------------------------------------------------------------------
// Take verification (avg-8hs.3): does the take say its text?
// ---------------------------------------------------------------------------
// Forced alignment always places every word of the text, even one never said:
// it squeezes it into a few milliseconds. So a take is verified two ways that
// do not depend on each other:
// - a transcription, made without the text, is compared with the text:
//   missing, extra and substituted words, by line;
// - the alignment's own timing shows runs of words given almost no time.
// It also measures, from the timing, every pause at a verse end, a stanza end
// and inside a line, and the take's edges. The report is data: what counts as
// too short a pause, or a missing word that matters, is the series' or the
// channel's rule, not the studio's.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { TAKES_PATH } from "./take-align.js";

export const verificationPathFor = (takeId: string) => `artifacts/takes/${takeId}.verification.json`;

/** A word the alignment gives less than this, in a run, was most likely not said. */
export const SQUEEZED_SECONDS = 0.1;
/** …at least this many words in a row, within one line. */
export const SQUEEZED_RUN = 3;
/** Pauses inside a line shorter than this are breath, not reported. */
export const LINE_PAUSE_FLOOR = 0.2;

export interface HeardWord { text: string; start: number; end: number; probability?: number }
export interface Transcript { text: string; words: HeardWord[]; model: string; language?: string }
export type Transcribe = (audioPath: string, language: string) => Promise<Transcript>;

export interface TakeVerification {
  apiVersion: "studio.video/v1alpha1";
  kind: "TakeVerification";
  take: { id: string; audio: { path: string; hash: string }; timing?: { path: string; hash: string } };
  transcriber: { model: string; language: string };
  heard: string;
  words: {
    expected: number;
    matched: number;
    /** Words of the text not heard, by line (1-based, counting text lines, blank ones included). */
    missing: { line: number; words: string; wholeLine: boolean }[];
    /** Words heard that the text does not have. */
    extra: { words: string; start: number; end: number }[];
    substituted: { line: number; expected: string; heard: string; start: number }[];
    /** Heard almost as written (che → chi): counted as heard, but worth a listen. */
    near: { line: number; expected: string; heard: string; start: number }[];
  };
  /**
   * Runs of words the alignment gave almost no time. `heard`: the transcription
   * heard them, so the timing is what is wrong; otherwise they were likely not said.
   */
  squeezed: { line: number; words: string; start: number; end: number; heard: boolean }[];
  pauses: {
    verse: PauseStats;
    stanza: PauseStats;
    /** Inside a line, at least LINE_PAUSE_FLOOR. */
    line: { after: string; line: number; seconds: number }[];
    all: { after: string; line: number; kind: "verse" | "stanza"; seconds: number }[];
  } | null;
  edges: { leadSeconds: number; tailSeconds: number; endsLoud: boolean } | null;
  /** What a person should look at, in plain words. */
  concerns: string[];
  createdAt: string;
}

export interface PauseStats { count: number; min: number | null; median: number | null; max: number | null }

// ── Words ───────────────────────────────────────────────────────────────────

/** One written word as compared: lower case, without accents, apostrophes or punctuation ("gl'irti" → "glirti"). */
export function normalizeToken(word: string): string {
  return word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** 1 for the same word, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** The same word as far as hearing goes: a spelling variant, an elision, a doubled consonant. */
const same = (a: string, b: string) => {
  if (a === b) return true;
  const s = similarity(a, b);
  return Math.max(a.length, b.length) <= 3 ? s >= 0.66 : s >= 0.7;
};

type Op =
  | { op: "match" | "sub"; ref: number[]; hyp: number[] }
  | { op: "del"; ref: number[]; hyp: [] }
  | { op: "ins"; ref: []; hyp: number[] };

/**
 * The cheapest alignment of the text's words with the words heard: matches,
 * substitutions, words missing or extra, and two words heard as one ("de i" →
 * "dei") or one as two. Dynamic programming, O(n·m).
 */
export function alignWords(ref: string[], hyp: string[]): Op[] {
  const n = ref.length;
  const m = hyp.length;
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(INF));
  const back: (Op["op"] | "merge" | "split" | null)[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  cost[0]![0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const here = cost[i]![j]!;
      if (here === INF) continue;
      const relax = (ii: number, jj: number, c: number, how: (typeof back)[0][0]) => {
        if (ii <= n && jj <= m && here + c < cost[ii]![jj]!) {
          cost[ii]![jj] = here + c;
          back[ii]![jj] = how;
        }
      };
      if (i < n && j < m) {
        const ok = same(ref[i]!, hyp[j]!);
        relax(i + 1, j + 1, ok ? 0 : 1 + (1 - similarity(ref[i]!, hyp[j]!)) * 0.5, ok ? "match" : "sub");
      }
      if (i < n) relax(i + 1, j, 1, "del");
      if (j < m) relax(i, j + 1, 1, "ins");
      // Two words as one only when nearly identical joined ("de i" → "dei"), never a word swallowed by its neighbour.
      if (i + 1 < n && j < m && similarity(ref[i]! + ref[i + 1]!, hyp[j]!) >= 0.85) relax(i + 2, j + 1, 0.1, "merge");
      if (i < n && j + 1 < m && similarity(ref[i]!, hyp[j]! + hyp[j + 1]!) >= 0.85) relax(i + 1, j + 2, 0.1, "split");
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const how = back[i]![j];
    if (how === "match" || how === "sub") { ops.push({ op: how, ref: [i - 1], hyp: [j - 1] }); i--; j--; }
    else if (how === "merge") { ops.push({ op: "match", ref: [i - 2, i - 1], hyp: [j - 1] }); i -= 2; j--; }
    else if (how === "split") { ops.push({ op: "match", ref: [i - 1], hyp: [j - 2, j - 1] }); i--; j -= 2; }
    else if (how === "del") { ops.push({ op: "del", ref: [i - 1], hyp: [] }); i--; }
    else { ops.push({ op: "ins", ref: [], hyp: [j - 1] }); j--; }
  }
  return ops.reverse();
}

/**
 * Every whitespace-separated token of the text, as the take's WordTiming has
 * them (one timing word per token), each with its line (1-based), stanza
 * (0-based) and whether it is said: «—», «…», «***» are written, not said.
 */
export function textTokens(text: string): { word: string; line: number; stanza: number; said: boolean }[] {
  const out: { word: string; line: number; stanza: number; said: boolean }[] = [];
  let stanza = 0;
  let seenWords = false;
  text.split(/\r?\n/).forEach((raw, index) => {
    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      if (seenWords) stanza++;
      seenWords = false;
      return;
    }
    for (const word of tokens) {
      const said = normalizeToken(word) !== "";
      if (said) seenWords = true;
      out.push({ word, line: index + 1, stanza, said });
    }
  });
  return out;
}

/** The text's said words, each with its line, stanza, whether it ends its line, and its index among all tokens. */
export function textWords(text: string): { word: string; line: number; stanza: number; lastOfLine: boolean; token: number }[] {
  const said = textTokens(text).map((t, token) => ({ ...t, token })).filter((t) => t.said);
  return said.map((t, k) => ({ word: t.word, line: t.line, stanza: t.stanza, token: t.token, lastOfLine: said[k + 1]?.line !== t.line }));
}

// ── The report ──────────────────────────────────────────────────────────────

const round = (n: number) => Math.round(n * 1000) / 1000;
/** Words heard are data, quoted short and on one line wherever they are shown. */
const quote = (text: string) => { const one = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim(); return one.length > 80 ? `${one.slice(0, 79)}…` : one; };
function stats(values: number[]): PauseStats {
  if (values.length === 0) return { count: 0, min: null, median: null, max: null };
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  return { count: s.length, min: round(s[0]!), median: round(mid), max: round(s[s.length - 1]!) };
}

export interface CompareInput {
  text: string;
  /** What the voice was given to say, when it differs from the text (numbers spelt out, pronunciations). */
  spokenText?: string;
  heard: Transcript;
  durationSeconds: number;
  /** The take's WordTiming words, one per written word, and its energy envelope. */
  timing?: { words: { text: string; start: number; end: number }[]; energy?: { rate: number; values: number[] } } | null;
}

/** Everything but the take's identity: the comparison itself, pure. */
export function compareTake(input: CompareInput): Omit<TakeVerification, "apiVersion" | "kind" | "take" | "transcriber" | "createdAt"> {
  // Words are compared with what the voice was given to say; the timing belongs to the written text.
  const spoken = input.spokenText?.trim() ? input.spokenText : input.text;
  const compared = textWords(spoken);
  const written = textWords(input.text);
  const ref = compared.map((w) => normalizeToken(w.word));
  const heardWords = input.heard.words.filter((w) => normalizeToken(w.text));
  const hyp = heardWords.map((w) => normalizeToken(w.text));
  const ops = alignWords(ref, hyp);
  // Which written words were heard, for the squeezed runs: the same ops when the text is what was said.
  const writtenOps = spoken === input.text ? ops : alignWords(written.map((w) => normalizeToken(w.word)), hyp);
  // What was spoken is reported by the written text's lines: a paragraph given to the voice still has the poem's verses.
  if (spoken !== input.text) {
    const lineOf: (number | undefined)[] = new Array(compared.length);
    for (const op of alignWords(compared.map((w) => normalizeToken(w.word)), written.map((w) => normalizeToken(w.word)))) {
      if ((op.op === "match" || op.op === "sub") && op.hyp.length > 0) for (const k of op.ref) lineOf[k] = written[op.hyp[0]!]!.line;
    }
    let last = written[0]?.line ?? 1;
    compared.forEach((w, k) => {
      w.line = lineOf[k] ?? last;
      last = w.line;
    });
  }

  const lineWords = new Map<number, number>();
  for (const w of compared) lineWords.set(w.line, (lineWords.get(w.line) ?? 0) + 1);
  // Runs of consecutive missing (or extra) words, `end` the last index taken.
  const missingRuns: { line: number; words: string[]; end: number }[] = [];
  const extraRuns: { words: string[]; start: number; end: number; last: number }[] = [];
  const substituted: TakeVerification["words"]["substituted"] = [];
  const near: TakeVerification["words"]["near"] = [];
  let matched = 0;
  const heardRef = new Set<number>();
  for (const op of writtenOps) if (op.op === "match" || op.op === "sub") for (const k of op.ref) heardRef.add(k);
  for (const op of ops) {
    if (op.op === "match") {
      matched += op.ref.length;
      if (op.ref.length === 1 && op.hyp.length === 1 && ref[op.ref[0]!] !== hyp[op.hyp[0]!]) {
        const w = compared[op.ref[0]!]!;
        const h = heardWords[op.hyp[0]!]!;
        near.push({ line: w.line, expected: w.word, heard: h.text, start: h.start });
      }
    } else if (op.op === "del") {
      const k = op.ref[0]!;
      const w = compared[k]!;
      const last = missingRuns[missingRuns.length - 1];
      if (last && last.line === w.line && last.end === k - 1) { last.words.push(w.word); last.end = k; }
      else missingRuns.push({ line: w.line, words: [w.word], end: k });
    } else if (op.op === "ins") {
      const k = op.hyp[0]!;
      const h = heardWords[k]!;
      const last = extraRuns[extraRuns.length - 1];
      if (last && last.last === k - 1) { last.words.push(h.text); last.end = h.end; last.last = k; }
      else extraRuns.push({ words: [h.text], start: h.start, end: h.end, last: k });
    } else {
      const w = compared[op.ref[0]!]!;
      const h = heardWords[op.hyp[0]!]!;
      substituted.push({ line: w.line, expected: w.word, heard: h.text, start: h.start });
    }
  }
  const missing = missingRuns.map((r) => ({ line: r.line, words: r.words.join(" "), wholeLine: r.words.length === lineWords.get(r.line) }));
  const extra = extraRuns.map((r) => ({ words: r.words.join(" "), start: r.start, end: r.end }));

  // Squeezed runs and pauses come from the alignment's timing, word for written word.
  // One timing word per written token, said or not; only the said ones are measured.
  const tokens = textTokens(input.text);
  const timed = input.timing?.words && input.timing.words.length === tokens.length && written.length > 0
    ? written.map((w) => input.timing!.words[w.token]!)
    : null;
  const squeezed: TakeVerification["squeezed"] = [];
  let pauses: TakeVerification["pauses"] = null;
  let edges: TakeVerification["edges"] = null;
  if (timed) {
    // Runs within one line, of at least SQUEEZED_RUN words: two short function words in a row are ordinary.
    let run: number[] = [];
    const flush = () => {
      if (run.length >= SQUEEZED_RUN) {
        squeezed.push({
          line: written[run[0]!]!.line, words: run.map((k) => written[k]!.word).join(" "),
          start: timed[run[0]!]!.start, end: timed[run[run.length - 1]!]!.end,
          heard: run.filter((k) => heardRef.has(k)).length * 2 > run.length,
        });
      }
      run = [];
    };
    timed.forEach((w, k) => {
      const short = w.end - w.start <= SQUEEZED_SECONDS + 1e-9;
      const continues = run.length > 0 && run[run.length - 1] === k - 1 && written[k]!.line === written[k - 1]!.line;
      if (!short || !continues) flush();
      if (short) run.push(k);
    });
    flush();
    const all: NonNullable<TakeVerification["pauses"]>["all"] = [];
    const line: NonNullable<TakeVerification["pauses"]>["line"] = [];
    for (let k = 0; k + 1 < timed.length; k++) {
      const gap = round(Math.max(0, timed[k + 1]!.start - timed[k]!.end));
      const w = written[k]!;
      if (w.lastOfLine) all.push({ after: w.word, line: w.line, kind: written[k + 1]!.stanza !== w.stanza ? "stanza" : "verse", seconds: gap });
      else if (gap >= LINE_PAUSE_FLOOR) line.push({ after: w.word, line: w.line, seconds: gap });
    }
    pauses = {
      verse: stats(all.filter((p) => p.kind === "verse").map((p) => p.seconds)),
      stanza: stats(all.filter((p) => p.kind === "stanza").map((p) => p.seconds)),
      line, all,
    };
    const energy = input.timing?.energy;
    const tailValues = energy && energy.values.length >= 3 ? energy.values.slice(-3) : [];
    edges = {
      leadSeconds: round(timed[0]!.start),
      tailSeconds: round(Math.max(0, input.durationSeconds - timed[timed.length - 1]!.end)),
      endsLoud: tailValues.length > 0 && Math.max(...tailValues) >= 0.3,
    };
  }

  const concerns: string[] = [];
  for (const m of missing) concerns.push(m.wholeLine ? `line ${m.line} is not heard at all: «${m.words}»` : `not heard in line ${m.line}: «${m.words}»`);
  for (const s of squeezed) {
    concerns.push(s.heard
      ? `the alignment crowds «${s.words}» (line ${s.line}) at ${s.start.toFixed(2)} s, though they are heard: the timing is wrong there, align the take again`
      : `the alignment gives «${s.words}» (line ${s.line}) almost no time at ${s.start.toFixed(2)} s: likely not said`);
  }
  for (const e of extra) concerns.push(`heard but not in the text, at ${e.start.toFixed(2)} s: «${quote(e.words)}»`);
  if (near.length > 0) concerns.push(`${near.length} words heard almost as written, worth a listen: ${near.slice(0, 5).map((n) => `«${quote(n.expected)}»→«${quote(n.heard)}»`).join(", ")}${near.length > 5 ? ", …" : ""}`);
  if (substituted.length > 0) concerns.push(`${substituted.length} words heard differently (a pronunciation, or the transcriber's spelling): ${substituted.slice(0, 5).map((s) => `«${quote(s.expected)}»→«${quote(s.heard)}»`).join(", ")}${substituted.length > 5 ? ", …" : ""}`);
  if (edges?.endsLoud) concerns.push("the audio ends while still loud: the last word may be cut off");
  if (!timed) concerns.push(input.timing ? "the timing does not have one word per written word: pauses and squeezed words not measured" : "no timing yet: align the take to measure its pauses");
  return {
    heard: input.heard.text,
    words: { expected: ref.length, matched, missing, extra, substituted, near },
    squeezed, pauses, edges, concerns,
  };
}

// ── In an episode ───────────────────────────────────────────────────────────

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export class VerifyError extends Error {
  constructor(readonly code: "no-such-take" | "audio-changed" | "worker-unreachable" | "transcriber-failed", message: string) {
    super(message);
    this.name = "VerifyError";
  }
}

/** POST /transcribe on the local voice worker. */
export function workerTranscriber(workerUrl: string): Transcribe {
  return async (audioPath, language) => {
    let response: Response;
    try {
      response = await fetch(`${workerUrl.replace(/\/$/, "")}/transcribe`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audio_path: audioPath, language }),
      });
    } catch {
      throw new VerifyError("worker-unreachable", `the voice worker at ${workerUrl} does not answer: start it (mise run voice-serve)`);
    }
    const body = await response.json().catch(() => undefined) as { text?: string; words?: HeardWord[]; model?: string; detail?: { msg?: string }[] } | undefined;
    if (response.status === 404 || response.status === 405) {
      throw new VerifyError("worker-unreachable", `the voice worker at ${workerUrl} has no /transcribe: it predates take verification, restart it from this checkout`);
    }
    if (!response.ok || !Array.isArray(body?.words)) {
      throw new VerifyError("transcriber-failed", `the voice worker could not transcribe: ${body?.detail?.[0]?.msg ?? `HTTP ${response.status}`}`);
    }
    return { text: String(body!.text ?? ""), words: body!.words!, model: String(body!.model ?? "unknown"), language };
  };
}

/**
 * Verify one take of artifacts/narration/takes.json in a workspace and write
 * artifacts/takes/<take>.verification.json. The audio must be the one the
 * take records.
 */
export async function verifyTake(workspaceDir: string, takeId: string, options: { transcribe: Transcribe; language?: string; now?: () => Date }): Promise<{ path: string; report: TakeVerification }> {
  const dir = resolve(workspaceDir);
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(join(dir, TAKES_PATH), "utf-8"));
  } catch {
    throw new VerifyError("no-such-take", `${TAKES_PATH} is missing or not JSON: register the take first (pva_register_take)`);
  }
  const take = (doc?.takes ?? []).find((t: any) => t?.id === takeId);
  if (!take) throw new VerifyError("no-such-take", `${TAKES_PATH} has no take "${takeId}"`);
  if (typeof take.audio?.path !== "string" || typeof take.audio?.hash !== "string") throw new VerifyError("no-such-take", `take "${takeId}" names no audio with its hash`);
  /** A file the take names, inside the workspace once links are followed; null when it is not there. */
  const inside = (path: string): string | null => {
    const full = resolve(dir, path);
    if (!existsSync(full)) return null;
    const real = realpathSync(full);
    const root = realpathSync(dir);
    return real.startsWith(root + sep) ? real : null;
  };
  const audioPath = inside(take.audio.path);
  if (!audioPath) throw new VerifyError("no-such-take", `take "${takeId}": its audio ${take.audio.path} is not in this workspace`);
  if (sha256(readFileSync(audioPath)) !== take.audio.hash) throw new VerifyError("audio-changed", `take "${takeId}": ${take.audio.path} is not the audio the take recorded`);
  let timing: CompareInput["timing"] = null;
  const timingPath = typeof take.timing?.path === "string" ? inside(take.timing.path) : null;
  if (timingPath) {
    const bytes = readFileSync(timingPath);
    // A timing changed since, or made for another audio, measures nothing of this one.
    if (sha256(bytes) === take.timing.hash) {
      try {
        const parsed = JSON.parse(bytes.toString("utf-8"));
        if (parsed?.audio?.hash === take.audio.hash && Array.isArray(parsed.words)) timing = { words: parsed.words, ...(parsed.energy ? { energy: parsed.energy } : {}) };
      } catch { /* not JSON: as if there were none */ }
    }
  }
  const language = options.language ?? take.language ?? "it";
  const heard = await options.transcribe(audioPath, language);
  const compared = compareTake({
    text: String(take.text ?? ""), ...(typeof take.spokenText === "string" ? { spokenText: take.spokenText } : {}),
    heard, durationSeconds: Number(take.audio.durationSeconds ?? 0), timing,
  });
  const report: TakeVerification = {
    apiVersion: "studio.video/v1alpha1",
    kind: "TakeVerification",
    take: { id: takeId, audio: { path: take.audio.path, hash: take.audio.hash }, ...(timing ? { timing: { path: take.timing.path, hash: take.timing.hash } } : {}) },
    transcriber: { model: heard.model, language },
    ...compared,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  };
  const path = verificationPathFor(takeId);
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  const temp = `${full}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temp, full);
  return { path, report };
}
