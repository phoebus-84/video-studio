// ---------------------------------------------------------------------------
// Registering a synthesized take (avg-dcf.6.6)
// ---------------------------------------------------------------------------
// A speech tool leaves a file; a series reads takes. registerTake makes the
// file a take of artifacts/narration/takes.json: its audio copied to
// assets/takes/<take>.<ext>, hashed and measured, its text and the voice that
// said it recorded, and the take placed in a unit's sequence (the short's
// "recital": titolo, then recita). Then pva_align_take measures its words and
// the compiler lays it out. Nothing is written unless the document is valid.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
import { measureSilences } from "./speech-align.js";
import { TAKES_PATH } from "./take-align.js";

/** Where a take's audio is kept: named by its content too, so no other take's file is ever overwritten. */
export const takeAudioPathFor = (takeId: string, hash: string, ext: string) => `assets/takes/${takeId}.${hash.replace(/^sha256:/, "").slice(0, 8)}${ext}`;
const AUDIO = new Set([".wav", ".mp3", ".m4a"]);

export class RegisterTakeError extends Error {
  constructor(readonly code: "bad-audio" | "bad-take", message: string) {
    super(message);
    this.name = "RegisterTakeError";
  }
}

export interface RegisterTakeOptions {
  take: string;
  /** The audio a speech tool made, relative to the episode (or absolute, inside it). */
  audio: string;
  /** The written text the take says. */
  text: string;
  /** What the tool was given, when it differs from `text`. */
  spokenText?: string;
  /** ISO 639-1, e.g. "it". */
  language?: string;
  role?: string;
  /** Provenance only: what made the take. */
  voice: { provider: string; model?: string; voiceId?: string; settings?: Record<string, unknown>; direction?: string };
  /**
   * The unit the take plays in: appended to its sequence, or kept in place
   * when already there — unless `position` (0-based) puts it there.
   */
  unit?: { id: string; pauseBefore?: number; position?: number };
}

export interface RegisteredTake {
  take: Record<string, unknown>;
  /** Relative to the episode. */
  audioPath: string;
  /** The unit's sequence after registering. */
  sequence?: { take: string; pauseBefore?: number }[];
  /** The take was there before, timed, with other audio or text: its timing was dropped. */
  timingDropped: boolean;
}

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let temporaries = 0;

function writeAtomically(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${temporaries++}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

const outside = (base: string, full: string) => {
  const rel = relative(base, full);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel);
};

/** Register (or replace) a take in artifacts/narration/takes.json. */
export async function registerTake(episodeDir: string, options: RegisterTakeOptions): Promise<RegisteredTake> {
  const root = realpathSync(episodeDir);
  const source = resolve(episodeDir, options.audio);
  if (outside(episodeDir, source) || !existsSync(source) || outside(root, realpathSync(source)) || !statSync(source).isFile()) {
    throw new RegisterTakeError("bad-audio", `${options.audio} is not a file of this episode`);
  }
  const ext = extname(source).toLowerCase();
  if (!AUDIO.has(ext)) throw new RegisterTakeError("bad-audio", `${options.audio} is not audio this studio takes (${[...AUDIO].join(", ")})`);

  // Read once: the bytes hashed are the bytes measured and kept, whatever the speech tool does to its file meanwhile.
  const bytes = readFileSync(source);
  const hash = sha256(bytes);
  const audioPath = takeAudioPathFor(options.take, hash, ext);
  const takesDir = join(episodeDir, "assets", "takes");
  mkdirSync(takesDir, { recursive: true });
  if (outside(root, realpathSync(takesDir))) throw new RegisterTakeError("bad-audio", "assets/takes leads out of this episode");
  const target = join(episodeDir, audioPath);
  const temp = `${target}.${process.pid}.${temporaries++}.tmp${ext}`;
  writeFileSync(temp, bytes);
  let durationSeconds: number;
  try {
    ({ durationSeconds } = await measureSilences(temp));
  } catch (error) {
    rmSync(temp, { force: true });
    throw new RegisterTakeError("bad-audio", `${options.audio} cannot be measured: ${(error as Error).message}`);
  }
  const audio = { path: audioPath, hash, durationSeconds: Math.round(durationSeconds * 1000) / 1000 };

  const takesFile = join(episodeDir, TAKES_PATH);
  const doc: any = existsSync(takesFile)
    ? JSON.parse(readFileSync(takesFile, "utf-8"))
    : { apiVersion: "studio.video/v1alpha1", kind: "NarrationTakes", takes: [], units: [] };

  const previous = doc.takes.find((t: { id: string }) => t.id === options.take);
  // What the take said before, unless told otherwise — for the same audio only: new audio was made from what the voice was given then.
  const spokenText = options.spokenText !== undefined ? options.spokenText
    : previous?.text === options.text && previous?.audio?.hash === hash ? previous?.spokenText : undefined;
  const language = options.language ?? previous?.language;
  const role = options.role ?? previous?.role;
  // A timing measures one audio saying one text in one language: any of them changed, it no longer holds.
  const timingDropped = !!previous?.timing
    && (previous.audio?.hash !== hash || previous.text !== options.text || previous.language !== language || previous.spokenText !== (spokenText !== options.text ? spokenText : undefined));
  const take: Record<string, unknown> = {
    id: options.take,
    audio,
    text: options.text,
    ...(spokenText !== undefined && spokenText !== options.text ? { spokenText } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(language !== undefined ? { language } : {}),
    voice: options.voice,
    ...(previous?.timing && !timingDropped ? { timing: previous.timing } : {}),
    ...(previous?.source ? { source: previous.source } : {}),
  };
  doc.takes = previous ? doc.takes.map((t: { id: string }) => (t.id === options.take ? take : t)) : [...doc.takes, take];

  let sequence: RegisteredTake["sequence"];
  if (options.unit) {
    let unit = doc.units.find((u: { id: string }) => u.id === options.unit!.id);
    if (!unit) {
      unit = { id: options.unit.id, sequence: [] };
      doc.units.push(unit);
    }
    const at = unit.sequence.findIndex((e: { take: string }) => e.take === options.take);
    const entry = at < 0 ? { take: options.take } : unit.sequence.splice(at, 1)[0];
    if (options.unit.pauseBefore !== undefined) entry.pauseBefore = options.unit.pauseBefore;
    const position = options.unit.position ?? (at < 0 ? unit.sequence.length : at);
    unit.sequence.splice(Math.max(0, Math.min(position, unit.sequence.length)), 0, entry);
    // The first take of a unit starts it; every later one says how long after the one before.
    unit.sequence.forEach((e: { pauseBefore?: number }, i: number) => {
      if (i === 0) delete e.pauseBefore;
      else e.pauseBefore ??= 0;
    });
    sequence = unit.sequence;
  }

  const problems = validateNarrationTakes(doc);
  if (problems.length > 0) {
    rmSync(temp, { force: true });
    throw new RegisterTakeError("bad-take", `${TAKES_PATH} would not be valid: ${problems.map((p: { code: string; path: string; message: string }) => `${p.code} at ${p.path}: ${p.message}`).join("; ")}`);
  }
  // The new file, then the document that names it; only then the old file, if nothing names it any more.
  renameSync(temp, target);
  writeAtomically(takesFile, `${JSON.stringify(doc, null, 2)}\n`);
  const old = previous?.audio?.path;
  if (typeof old === "string" && old !== audioPath && old.startsWith("assets/takes/") && !doc.takes.some((t: { audio?: { path?: string } }) => t.audio?.path === old)) {
    rmSync(join(episodeDir, old), { force: true });
  }
  return { take, audioPath, ...(sequence ? { sequence } : {}), timingDropped };
}
