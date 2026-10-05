// ---------------------------------------------------------------------------
// Cues: when something happens, in terms of the voice
// ---------------------------------------------------------------------------
// A series spec says "on the word lampo", "at the end of verse 3", "four
// seconds after the poem". The edit timeline only knows frames. A cue is
// resolved in a SCOPE — one take's WordTiming placed in the episode — into an
// absolute frame:
//
//   time in the take (word / line / take / mark / seconds)
//   + offset + scope.startSeconds, then × fps, rounded to the nearest frame.
//
// Words match WHOLE, ignoring case, accents and punctuation, also after an
// elision ("italia" finds "L'Italia,"); a trailing * matches by prefix. Words
// are matched on their written text, never on how they were pronounced.
//
// A cue that cannot be resolved is a problem, never a fallback: no default
// time, no clamped verse number. resolveCues reports every one with its path.
// ---------------------------------------------------------------------------

import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schemas/v1alpha1/cue.schema.json" with { type: "json" };

/** Slack for binary floating point: 0.1 + 0.7 - 0.8 is -1.1e-16, which is the start, not before it. */
const FLOAT_EPSILON = 1e-9;

let compiled = null;

function cueValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(schema);
    compiled = ajv.getSchema(`${schema.$id}#/$defs/Cue`);
  }
  return compiled;
}

/** Lower-case, no accents, letters and digits only: "Perché," → "perche". */
export function normalizeWord(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The normalised forms a spoken word can be matched by: the whole token, and what follows its last apostrophe. */
function forms(text) {
  const parts = text.split(/['’]/);
  return [normalizeWord(text), normalizeWord(parts[parts.length - 1])];
}

function problem(code, message) {
  return { problem: { code, message } };
}

function checkScope(scope) {
  if (!Number.isInteger(scope?.fps) || scope.fps <= 0) {
    throw new TypeError(`scope.fps must be a positive integer, got ${scope?.fps}`);
  }
  if (!Number.isFinite(scope.startSeconds) || scope.startSeconds < 0) {
    throw new TypeError(`scope.startSeconds must be a finite number >= 0, got ${scope.startSeconds}`);
  }
  for (const [name, value] of Object.entries(scope.marks ?? {})) {
    if (!Number.isFinite(value)) throw new TypeError(`scope.marks["${name}"] must be a finite number of seconds, got ${JSON.stringify(value)}`);
  }
}

/** Seconds in the take for a validated cue, or a problem. */
function timeInTake(cue, timing, marks) {
  if (typeof cue === "number") return { seconds: cue };
  if (typeof cue === "string") return wordTime({ word: cue }, timing);
  if ("word" in cue) return wordTime(cue, timing);
  if ("line" in cue) {
    const line = timing.lines?.[cue.line - 1];
    if (!line) {
      const count = timing.lines?.length ?? 0;
      return problem("unknown-line", `line ${cue.line} does not exist: take "${timing.take.id}" has ${count} line${count === 1 ? "" : "s"}`);
    }
    const word = cue.at === "end" ? timing.words[line.lastWord] : timing.words[line.firstWord];
    return { seconds: cue.at === "end" ? word.end : word.start };
  }
  if ("take" in cue) {
    return { seconds: cue.take === "end" ? timing.words[timing.words.length - 1].end : 0 };
  }
  if (!marks || !Object.hasOwn(marks, cue.mark)) {
    return problem("unknown-mark", `mark "${cue.mark}" is not defined for take "${timing.take.id}"`);
  }
  return { seconds: marks[cue.mark] };
}

function wordTime(cue, timing) {
  const prefix = cue.word.endsWith("*");
  const key = normalizeWord(prefix ? cue.word.slice(0, -1) : cue.word);
  if (key === "") return problem("invalid-cue", `word "${cue.word}" has no letters or digits to match`);
  const matches = (text) => forms(text).some((f) => (prefix ? f.startsWith(key) : f === key));
  const found = timing.words.filter((w) => matches(w.text));
  const n = cue.n ?? 1;
  if (found.length < n) {
    const times = found.length === 0 ? "never" : `only ${found.length} time${found.length === 1 ? "" : "s"}`;
    return problem("unknown-word", `"${cue.word}"${n > 1 ? ` #${n}` : ""}: take "${timing.take.id}" says it ${times}`);
  }
  const word = found[n - 1];
  return { seconds: cue.at === "end" ? word.end : word.start };
}

/**
 * Resolve one cue against one take placed in the episode.
 * @param {unknown} cue
 * @param {{timing: object, startSeconds: number, fps: number, marks?: Record<string, number>}} scope
 * @returns {{frame: number, seconds: number} | {problem: {code: string, message: string}}}
 */
export function resolveCue(cue, scope) {
  checkScope(scope);
  const validate = cueValidator();
  if (!validate(cue)) {
    return problem("invalid-cue", `not a cue: ${JSON.stringify(cue)} (${validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")})`);
  }
  const inTake = timeInTake(cue, scope.timing, scope.marks);
  if (inTake.problem) return inTake;
  const offset = typeof cue === "object" ? cue.offset ?? 0 : 0;
  let seconds = scope.startSeconds + inTake.seconds + offset;
  if (!Number.isFinite(seconds * scope.fps)) {
    return problem("invalid-cue", `${JSON.stringify(cue)} resolves to a time no frame can hold`);
  }
  if (seconds < -FLOAT_EPSILON) {
    return problem("before-start", `resolves to ${seconds.toFixed(3)} s, before the start of the episode`);
  }
  if (seconds < 0) seconds = 0; // zero up to rounding, and never -0
  return { frame: Math.round(seconds * scope.fps), seconds };
}

/**
 * Resolve every cue a series compiler collected from its spec.
 * @param {{path: string, cue: unknown, scope: object}[]} entries
 * @returns {{frames: Record<string, number>, problems: {code: string, message: string, path: string}[]}}
 */
export function resolveCues(entries) {
  const frames = {};
  const problems = [];
  for (const { path, cue, scope } of entries) {
    const result = resolveCue(cue, scope);
    if (result.problem) problems.push({ ...result.problem, path });
    else frames[path] = result.frame;
  }
  return { frames, problems };
}
