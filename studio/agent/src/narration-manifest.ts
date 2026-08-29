// ---------------------------------------------------------------------------
// Canonical narration manifest
// ---------------------------------------------------------------------------
// `artifacts/narration/narration-manifest.json` is what tells the studio which
// narration clips an episode has, in what order, how long each runs and what
// it says. Every reader downstream -- the gateway's episode detail, the scene
// spine, the runtime's timing and caption stages -- goes through it.
//
// Nothing in the agent ever wrote one. `pva_synthesize_speech` drops a WAV per
// scene and stops there; the voice worker builds a correct manifest, but only
// through its mastering flow, which the agent path never calls. So when a
// session needed a manifest it invented the shape, and produced a file with
// `segments[]` carrying `sceneId`/`audioPath` where the contract says
// `entries[]` carrying `segmentId` and a `wav` artifact. It looked complete and
// it named a correct `finalWav`, so composition worked -- but every canonical
// reader tests for `entries` and skips a manifest without them, silently, as
// though no manifest existed at all.
//
// This is that writer. The shape is produced by code from measured facts, so
// there is nothing left to improvise.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { basename, dirname, join, isAbsolute, relative } from "node:path";

/** Schema version of the document this module writes. */
export const NARRATION_MANIFEST_SCHEMA = "narration-manifest/v1";

/** Measured facts about one WAV file, as the contract records them. */
export interface WavFacts {
  path: string;
  contentHash: string;
  sizeBytes: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  sampleWidthBytes: number;
}

/** One narration segment, before it becomes an entry and a caption. */
export interface NarrationSegmentInput {
  segmentId: string;
  /** Episode-relative path to the segment's WAV. */
  wavPath: string;
  /** Spoken text. Becomes the caption; omitted segments get no cue. */
  text?: string;
  /** Silence after this segment, in milliseconds. */
  pauseAfterMs?: number;
  acceptedAttemptId?: string;
}

export interface NarrationManifestInput {
  episodeId?: string;
  sourceRevision?: string;
  segments: NarrationSegmentInput[];
  /** Episode-relative path to the assembled narration. */
  finalWavPath?: string;
}

// ── WAV facts ───────────────────────────────────────────────────────────────

/**
 * Read a WAV's real duration from its header.
 *
 * Deriving it from the file size instead means assuming a sample rate. The
 * gateway does exactly that, hardcoding 24 kHz -- correct for the segments this
 * worker emits and wrong by a factor of two for a 48 kHz mastered final, with
 * a silent five-second default when the read fails. A measured duration that
 * disagrees with the audio is worse than none: the timeline, the captions and
 * the render all inherit it.
 */
export function readWavFacts(absolutePath: string, recordedPath: string): WavFacts {
  const bytes = readFileSync(absolutePath);
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${basename(absolutePath)} is not a RIFF/WAVE file`);
  }

  let sampleRate = 0;
  let channels = 0;
  let sampleWidthBytes = 0;
  let dataBytes = 0;

  // Chunks are walked rather than assumed at fixed offsets: a WAV may carry
  // LIST or fact chunks before the data, and a fixed 44-byte header guess reads
  // those as audio.
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const id = bytes.toString("ascii", cursor, cursor + 4);
    const size = bytes.readUInt32LE(cursor + 4);
    const body = cursor + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      channels = bytes.readUInt16LE(body + 2);
      sampleRate = bytes.readUInt32LE(body + 4);
      sampleWidthBytes = Math.ceil(bytes.readUInt16LE(body + 14) / 8);
    } else if (id === "data") {
      // A truncated file reports more data than it holds; trust the bytes.
      dataBytes = Math.min(size, bytes.length - body);
      break;
    }
    cursor = body + size + (size % 2);
  }

  const frameBytes = channels * sampleWidthBytes;
  if (!sampleRate || !frameBytes || !dataBytes) {
    throw new Error(`${basename(absolutePath)} has no readable WAV format or data chunk`);
  }

  return {
    path: recordedPath,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    sizeBytes: bytes.length,
    durationSeconds: Number((dataBytes / (sampleRate * frameBytes)).toFixed(6)),
    sampleRate,
    channels,
    sampleWidthBytes,
  };
}

// ── Building ────────────────────────────────────────────────────────────────

function episodeRelative(episodeDir: string, target: string): string {
  return isAbsolute(target) ? relative(episodeDir, target) : target;
}

/**
 * Build the canonical document from measured segments.
 *
 * Caption timings accumulate duration and then the pause that follows it, the
 * same rule the voice worker applies when it masters a narration. Two writers
 * disagreeing about where a pause sits would put the studio's captions and the
 * rendered audio out of step by the sum of the gaps.
 */
export function buildNarrationManifest(
  episodeDir: string,
  input: NarrationManifestInput,
): Record<string, unknown> {
  if (input.segments.length === 0) {
    throw new Error("A narration manifest needs at least one segment");
  }

  const seen = new Set<string>();
  const entries: Record<string, unknown>[] = [];
  const captions: Record<string, unknown>[] = [];
  let cursor = 0;

  input.segments.forEach((segment, index) => {
    if (!segment.segmentId) throw new Error(`Segment ${index} has no segmentId`);
    if (seen.has(segment.segmentId)) {
      throw new Error(`Segment ${segment.segmentId} appears more than once`);
    }
    seen.add(segment.segmentId);

    const recorded = episodeRelative(episodeDir, segment.wavPath);
    const absolute = isAbsolute(segment.wavPath) ? segment.wavPath : join(episodeDir, segment.wavPath);
    if (!existsSync(absolute)) {
      throw new Error(`Segment ${segment.segmentId} names a WAV that does not exist: ${recorded}`);
    }
    const wav = readWavFacts(absolute, recorded);
    const pauseAfterMs = Math.max(0, Math.round(segment.pauseAfterMs ?? 0));

    const entry: Record<string, unknown> = { segmentId: segment.segmentId, wav, pauseAfterMs };
    if (segment.acceptedAttemptId) entry.acceptedAttemptId = segment.acceptedAttemptId;
    entries.push(entry);

    if (segment.text) {
      captions.push({
        segmentId: segment.segmentId,
        index: captions.length + 1,
        startSeconds: Number(cursor.toFixed(6)),
        endSeconds: Number((cursor + wav.durationSeconds).toFixed(6)),
        text: segment.text,
      });
    }
    cursor = cursor + wav.durationSeconds + pauseAfterMs / 1000;
  });

  const document: Record<string, unknown> = {
    schemaVersion: NARRATION_MANIFEST_SCHEMA,
    entries,
    createdAt: new Date().toISOString(),
  };
  if (input.episodeId) document.episodeId = input.episodeId;
  if (input.sourceRevision) document.sourceRevision = input.sourceRevision;
  if (captions.length > 0) document.captions = captions;

  if (input.finalWavPath) {
    const recorded = episodeRelative(episodeDir, input.finalWavPath);
    const absolute = isAbsolute(input.finalWavPath)
      ? input.finalWavPath
      : join(episodeDir, input.finalWavPath);
    if (!existsSync(absolute)) {
      throw new Error(`The final WAV does not exist: ${recorded}`);
    }
    document.finalWav = readWavFacts(absolute, recorded);
  }

  return document;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Why a manifest is not canonical, in the reader's terms.
 *
 * Readers skip a non-conforming manifest and fall back as though none existed,
 * which is how a file with eleven complete segments read as no narration at
 * all. Saying what is wrong turns that into a sentence instead of a search.
 */
export function validateNarrationManifest(document: unknown): string[] {
  const problems: string[] = [];
  const doc = document as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return ["The manifest is not a JSON object"];
  }

  const entries = doc.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    problems.push(
      Array.isArray(doc.segments)
        ? `The manifest has ${doc.segments.length} 'segments' but no 'entries'; canonical readers only look at 'entries'`
        : "The manifest has no 'entries' array",
    );
    return problems;
  }

  entries.forEach((raw, index) => {
    const entry = raw as Record<string, unknown> | null;
    if (!entry || typeof entry !== "object") {
      problems.push(`Entry ${index} is not an object`);
      return;
    }
    const id = entry.segmentId ?? entry.segment_id;
    if (typeof id !== "string" || id.length === 0) {
      problems.push(`Entry ${index} has no 'segmentId'`);
    }
    const wav = entry.wav as Record<string, unknown> | undefined;
    if (!wav || typeof wav !== "object") {
      problems.push(`Entry ${index} has no 'wav' artifact`);
      return;
    }
    if (typeof wav.path !== "string" || wav.path.length === 0) {
      problems.push(`Entry ${index} has no 'wav.path'`);
    }
    const duration = wav.durationSeconds ?? wav.duration_seconds;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      problems.push(`Entry ${index} has no measured 'wav.durationSeconds'`);
    }
  });

  return problems;
}

// ── Assembling from what is on disk ─────────────────────────────────────────

/** Order `s1, s2, s4a, s10` the way a person reads them, not the way ASCII does. */
export function naturalSegmentOrder(left: string, right: string): number {
  const parse = (value: string): [number, string] => {
    const match = /^(?:s|scene-?)(\d+)([a-z]?)$/i.exec(value);
    return match ? [Number(match[1]), match[2] ?? ""] : [Number.MAX_SAFE_INTEGER, value];
  };
  const [leftNumber, leftSuffix] = parse(left);
  const [rightNumber, rightSuffix] = parse(right);
  if (leftNumber !== rightNumber) return leftNumber - rightNumber;
  return leftSuffix.localeCompare(rightSuffix) || left.localeCompare(right);
}

/**
 * Read the segments out of a manifest written in the improvised shape.
 *
 * The pause after a segment is not recorded there, but the gap to the next
 * segment's start is the same quantity, so it can be recovered exactly.
 */
export function segmentsFromLegacyManifest(document: unknown): NarrationSegmentInput[] {
  const doc = document as Record<string, unknown> | null;
  const rows = doc && Array.isArray(doc.segments) ? doc.segments : [];
  const parsed = rows
    .map((raw) => raw as Record<string, unknown>)
    .filter((row) => row && typeof row === "object");

  return parsed.map((row, index): NarrationSegmentInput => {
    const next = parsed[index + 1];
    const end = typeof row.endSeconds === "number" ? row.endSeconds : undefined;
    const nextStart = next && typeof next.startSeconds === "number" ? next.startSeconds : undefined;
    const gap = end !== undefined && nextStart !== undefined ? Math.max(0, nextStart - end) : 0;
    return {
      segmentId: String(row.sceneId ?? row.segmentId ?? `s${index + 1}`),
      wavPath: String(row.audioPath ?? row.wavPath ?? ""),
      text: typeof row.text === "string" ? row.text : undefined,
      pauseAfterMs: Math.round(gap * 1000),
    };
  });
}

/** Narration texts the studio persists, keyed by segment. */
function textsFromScript(episodeDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const scriptPath = join(episodeDir, "artifacts", "narration-script.json");
  try {
    const rows = JSON.parse(readFileSync(scriptPath, "utf-8"));
    for (const raw of Array.isArray(rows) ? rows : []) {
      const row = raw as { id?: string; segmentId?: string; text?: string };
      const id = row.segmentId ?? row.id;
      if (id && typeof row.text === "string") out.set(id, row.text);
    }
  } catch { /* optional */ }
  return out;
}

/**
 * Work out the manifest's segments from whatever the episode already has.
 *
 * A manifest in the improvised shape is the best source, because it carries the
 * spoken text and the pauses. Failing that the WAV files themselves are enough
 * for a manifest that is correct if silent on captions.
 */
export function assembleNarrationSegments(
  episodeDir: string,
  explicit?: NarrationSegmentInput[],
): NarrationSegmentInput[] {
  if (explicit && explicit.length > 0) return explicit;

  const narrationDir = join(episodeDir, "artifacts", "narration");
  const manifestPath = join(narrationDir, "narration-manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const recovered = segmentsFromLegacyManifest(existing).filter((s) => s.wavPath);
      if (recovered.length > 0) return recovered;
    } catch { /* unreadable; fall through to the files */ }
  }

  const texts = textsFromScript(episodeDir);
  const ids = readdirSync(narrationDir)
    .filter((file) => /^(?:s|scene-?)\d+[a-z]?\.wav$/i.test(file))
    .map((file) => file.slice(0, -4))
    .sort(naturalSegmentOrder);

  return ids.map((id) => ({
    segmentId: id,
    wavPath: join("artifacts", "narration", `${id}.wav`),
    text: texts.get(id),
  }));
}

/** The assembled narration, if one has been rendered. */
export function findFinalWav(episodeDir: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  for (const candidate of ["narration-full.wav", "narration.wav", "narration-premaster.wav"]) {
    if (existsSync(join(episodeDir, "artifacts", "narration", candidate))) {
      return join("artifacts", "narration", candidate);
    }
  }
  return undefined;
}

/**
 * Write the canonical manifest for an episode.
 *
 * Written through a temporary file. A reader that catches a half-written
 * manifest parses a truncated document, finds no entries and reports the
 * episode as having no narration -- the exact failure this replaces.
 */
export function writeNarrationManifest(
  episodeDir: string,
  document: Record<string, unknown>,
): string {
  const problems = validateNarrationManifest(document);
  if (problems.length > 0) {
    throw new Error(`Refusing to write a non-canonical manifest: ${problems.join("; ")}`);
  }
  const target = join(episodeDir, "artifacts", "narration", "narration-manifest.json");
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
  renameSync(temporary, join(dirname(target), basename(target)));
  return target;
}
