// ---------------------------------------------------------------------------
// Aligning a narration take (avg-8hs.2, ADR-0038)
// ---------------------------------------------------------------------------
// A take's WordTiming — every word of its written text with its start and
// end in the take's audio — measured by forced alignment: Qwen3-ForcedAligner
// in the local voice worker by default, ElevenLabs when a person asks for it,
// never one in place of the other. The provider's words go through the same
// post-processing either way (speech-align.ts); the timing is written beside
// the take and takes.json points at it.
//
// This module reads no environment: the caller supplies the worker's URL,
// the ElevenLabs key and the spend function that pays for its calls.
// ---------------------------------------------------------------------------

import { editRecordFor } from "./audio-edit.js";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ELEVENLABS_PROFILES, ElevenLabsError, forcedAlignment } from "@av/elevenlabs";
import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
import { AlignError, mapToText, measureEnergy, measureSilences, snapToSilences, type RawWord } from "./speech-align.js";

export const TAKES_PATH = "artifacts/narration/takes.json";
/** Where a take's timing goes when takes.json names none. */
export const timingPathFor = (takeId: string) => `artifacts/timing/${takeId}.json`;
/** Pauses inside the speech longer than this are reported (judging them is avg-8hs.3). */
export const REPORTED_PAUSE_SECONDS = 0.35;

/** derived: the words an audio edit carried from the takes it was cut from (avg-8hs.5). */
export type AlignProvider = "qwen-local" | "elevenlabs" | "derived";

/** What aligning `minutes` of audio with ElevenLabs is estimated to cost, in US dollars (its profile). */
export const elevenLabsAlignmentUsd = (minutes: number) => minutes * ELEVENLABS_PROFILES.forcedAlignment.usdPerMinute;

export interface AlignTakeOptions {
  take: string;
  /** Default qwen-local. */
  provider?: AlignProvider;
  /** The take's language when takes.json gives none (ISO 639-1, e.g. "it"). */
  language?: string;
  /** The local voice worker; required for qwen-local. */
  workerUrl?: string;
  elevenlabs?: {
    apiKey: string;
    baseUrl?: string;
    /** Reserve and settle the call's estimated cost; may refuse (AlignError "budget"). */
    pay?: <T>(minutes: number, call: () => Promise<T>) => Promise<T>;
  };
}

export interface AlignedTake {
  /** The WordTiming written. */
  timing: Record<string, unknown> & { words: { text: string; start: number; end: number }[] };
  /** Relative to the episode. */
  path: string;
  /** Words of the text the aligner did not place (given the gap around them). */
  unmapped: string[];
  /** Pauses inside the speech longer than REPORTED_PAUSE_SECONDS, in seconds. */
  pauses: number[];
}

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let temporaries = 0;

function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${temporaries++}.tmp`;
  writeFileSync(temp, text, "utf-8");
  renameSync(temp, path);
}

const outside = (base: string, full: string) => {
  const rel = relative(base, full);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel);
};

/** A path takes.json names, confined to the episode — links followed, when the file exists. */
function inEpisode(episodeDir: string, path: unknown, what: string): string {
  const full = typeof path === "string" ? resolve(episodeDir, path) : "";
  if (!full || outside(episodeDir, full)) throw new AlignError("no-such-take", `${what} ${String(path)} is not a file of this episode`);
  let real: string | null = null;
  try {
    real = realpathSync(full);
  } catch {
    /* not there yet (a timing file to write), or missing (reported by the caller) */
  }
  if (real !== null && outside(realpathSync(episodeDir), real)) {
    throw new AlignError("no-such-take", `${what} ${String(path)} leads out of this episode`);
  }
  return full;
}

async function alignLocally(workerUrl: string | undefined, audioPath: string, text: string, language: string): Promise<{ words: RawWord[]; model: string }> {
  if (!workerUrl) throw new AlignError("worker-unreachable", "no voice worker URL was given");
  let response: Response;
  try {
    response = await fetch(`${workerUrl.replace(/\/$/, "")}/align`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio_path: audioPath, text, language }),
    });
  } catch {
    throw new AlignError("worker-unreachable", `the voice worker at ${workerUrl} does not answer: start it (mise run voice-serve)`);
  }
  const body = await response.json().catch(() => undefined) as { words?: RawWord[]; model?: string; detail?: { type?: string; msg?: string }[] } | undefined;
  if (!response.ok) {
    const detail = body?.detail?.[0];
    const known = ["too-long", "unsupported-language", "bad-audio", "empty-text", "model-unavailable"];
    // The worker answered: whatever went wrong, it is not unreachable.
    const code = known.includes(detail?.type ?? "") ? detail!.type as "too-long" : "aligner-failed";
    throw new AlignError(code, `the voice worker could not align: ${detail?.msg ?? `HTTP ${response.status}`}`);
  }
  if (!Array.isArray(body?.words)) throw new AlignError("aligner-failed", "the voice worker answered without words");
  return { words: body.words, model: String(body.model ?? "unknown") };
}

/** The words the edit that made this audio carried; the edit's record names the model. */
function derivedWords(episodeDir: string, hash: string, takeId: string): { words: RawWord[]; model: string } {
  const found = editRecordFor(episodeDir, hash);
  if (!found) throw new AlignError("no-edit", `take "${takeId}": no audio edit in this workspace made this audio (no <file>.edit.json names its hash): align it with qwen-local`);
  if (!found.record.words || found.record.words.length === 0) throw new AlignError("no-edit", `take "${takeId}": the edit ${found.path} carried no words (its clips were not cut from aligned takes): align it with qwen-local`);
  return { words: found.record.words, model: found.path };
}

async function alignWithElevenLabs(options: AlignTakeOptions["elevenlabs"], audioPath: string, text: string, minutes: number): Promise<{ words: RawWord[]; model: string }> {
  if (!options?.apiKey) throw new AlignError("no-key", "ElevenLabs needs its API key (ELEVENLABS_API_KEY)");
  const call = async () => {
    try {
      return await forcedAlignment({ audioPath, text, apiKey: options.apiKey, ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}) });
    } catch (error) {
      if (error instanceof ElevenLabsError) throw new AlignError(error.code, error.message);
      throw error;
    }
  };
  const result = options.pay ? await options.pay(minutes, call) : await call();
  return { words: result.words, model: "forced-alignment" };
}

/**
 * Align one take of artifacts/narration/takes.json and write its WordTiming;
 * takes.json then names it. Nothing is written unless the timing is valid.
 */
export async function alignTake(episodeDir: string, options: AlignTakeOptions): Promise<AlignedTake> {
  const provider = options.provider ?? "qwen-local";
  const takesPath = join(episodeDir, TAKES_PATH);
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(takesPath, "utf-8"));
  } catch {
    throw new AlignError("no-such-take", `${TAKES_PATH} is missing or not JSON`);
  }
  const problems = validateNarrationTakes(doc);
  if (problems.length > 0) throw new AlignError("no-such-take", `${TAKES_PATH} is not valid: ${problems.map((p) => p.message).join("; ")}`);
  const index = doc.takes.findIndex((t: { id: string }) => t.id === options.take);
  if (index < 0) throw new AlignError("no-such-take", `${TAKES_PATH} has no take "${options.take}"`);
  const take = doc.takes[index];
  const language = take.language ?? options.language;
  if (!language) throw new AlignError("no-language", `take "${take.id}" has no language: give one (e.g. "it")`);

  const audioPath = inEpisode(episodeDir, take.audio.path, "audio");
  let audioBytes: Buffer;
  try {
    audioBytes = readFileSync(audioPath);
  } catch {
    throw new AlignError("audio-changed", `${take.audio.path} is missing`);
  }
  if (sha256(audioBytes) !== take.audio.hash) {
    throw new AlignError("audio-changed", `${take.audio.path} is not the audio ${TAKES_PATH} names: record the take again, or update it`);
  }

  const aligned = provider === "derived"
    ? derivedWords(episodeDir, take.audio.hash, take.id)
    : provider === "elevenlabs"
    ? await alignWithElevenLabs(options.elevenlabs, audioPath, take.text, take.audio.durationSeconds / 60)
    : await alignLocally(options.workerUrl, audioPath, take.text, language);
  const { words, unmapped } = mapToText(take.text, aligned.words);
  const measured = await measureSilences(audioPath);
  const timed = snapToSilences(words, measured.silences, measured.durationSeconds);
  const energy = await measureEnergy(audioPath, take.audio.durationSeconds);

  const timing = {
    apiVersion: "studio.video/v1alpha1",
    kind: "WordTiming",
    take: { id: take.id, ...(take.source ? { source: take.source } : {}) },
    audio: { ...take.audio },
    text: take.text,
    ...(take.spokenText ? { spokenText: take.spokenText } : {}),
    language,
    alignment: { provider: provider === "derived" ? "audio-edit" : provider, model: aligned.model, method: provider === "derived" ? "derived" : "forced", createdAt: new Date().toISOString() },
    words: timed,
    speech: measured.speech,
    energy,
  };
  const timingProblems = validateWordTiming(timing, { audioHash: take.audio.hash });
  if (timingProblems.length > 0) {
    throw new AlignError("alignment-mismatch", `the alignment is not a valid WordTiming: ${timingProblems.map((p) => `${p.code} at ${p.path}`).join("; ")}`);
  }

  const path = take.timing?.path ?? timingPathFor(take.id);
  const timingFile = inEpisode(episodeDir, path, "timing");
  const text = `${JSON.stringify(timing, null, 2)}\n`;
  // takes.json as it is now — another take may have been aligned meanwhile —
  // with only this take's timing set; and only if this take is still the one aligned.
  const current = JSON.parse(readFileSync(takesPath, "utf-8"));
  const now = current?.takes?.find?.((t: { id: string }) => t.id === take.id);
  if (!now || now.audio?.hash !== take.audio.hash || now.text !== take.text) {
    throw new AlignError("audio-changed", `take "${take.id}" changed in ${TAKES_PATH} while it was being aligned: align it again`);
  }
  now.timing = { path, hash: sha256(text) };
  const updatedProblems = validateNarrationTakes(current);
  if (updatedProblems.length > 0) throw new Error(`${TAKES_PATH} would not be valid: ${updatedProblems.map((p) => p.message).join("; ")}`);
  writeAtomically(timingFile, text);
  writeAtomically(takesPath, `${JSON.stringify(current, null, 2)}\n`);

  const pauses = measured.silences
    .filter(([s, e]) => s > 0 && e < measured.durationSeconds && e - s > REPORTED_PAUSE_SECONDS)
    .map(([s, e]) => Math.round((e - s) * 1000) / 1000);
  return { timing, path, unmapped: unmapped.map((i) => words[i]!.text), pauses };
}
