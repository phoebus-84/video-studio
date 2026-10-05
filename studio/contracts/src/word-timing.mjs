// ---------------------------------------------------------------------------
// Word timing per take
// ---------------------------------------------------------------------------
// When each word of one audio take is spoken, in seconds of that audio. The
// take may come from any TTS (the local Qwen worker, ElevenLabs) or a
// recording, and the timing from any aligner (forced alignment, whisper):
// the contract records which, but depends on neither.
//
// Words carry the WRITTEN token — what is on screen, what a cue names — and
// `spoken` only where the pronunciation differs ("Myricae." / "Mirìce.").
// Lines are ranges of words, so their text and times cannot disagree with
// the words. The audio hash binds the timing to one exact file: timing made
// for another take is rejected when the caller passes the real hash.
//
// Every problem is reported, not just the first, as { code, message, path },
// in the same shape as validateEditTimeline.
// ---------------------------------------------------------------------------

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schemas/v1alpha1/word-timing.schema.json" with { type: "json" };
import { jsonPath } from "./edit-timeline.mjs";

/** A word may start this much before the previous one ends (aligner rounding). */
export const WORD_OVERLAP_TOLERANCE_SECONDS = 0.001;
/** A word or speech span may end this much after the audio does. */
export const DURATION_TOLERANCE_SECONDS = 0.05;
/** The energy envelope may be this many samples longer or shorter than the audio. */
export const ENERGY_LENGTH_TOLERANCE_SAMPLES = 1;
/**
 * Slack for binary floating point: 47.833 + 0.05 is 47.882999…, so a word
 * ending at exactly 47.883 — exactly 50 ms late — must not be flagged.
 */
const FLOAT_EPSILON = 1e-9;

let compiled = null;

function schemaValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(schema);
    compiled = ajv.getSchema(`${schema.$id}#/$defs/WordTiming`);
  }
  return compiled;
}

function issue(code, path, message) {
  return { code, message, path };
}

const collapse = (text) => text.trim().split(/\s+/).join(" ");

/**
 * Validate a WordTiming document.
 * @param {unknown} doc
 * @param {{audioHash?: string | null} | null} [options] the real hash of the audio file, when the caller has it
 * @returns {{code: string, message: string, path: string}[]} every problem; empty when valid.
 */
export function validateWordTiming(doc, options) {
  const audioHash = options?.audioHash ?? undefined;
  const validate = schemaValidator();
  if (!validate(doc)) {
    return validate.errors.map((e) =>
      issue("schema", jsonPath(e.instancePath), `${e.instancePath || "/"} ${e.message}`),
    );
  }
  return [
    ...checkAudio(doc, audioHash),
    ...checkWords(doc),
    ...checkText(doc),
    ...checkLines(doc),
    ...checkSpeech(doc),
    ...checkEnergy(doc),
  ];
}

function checkAudio(doc, audioHash) {
  if (audioHash === undefined || audioHash === doc.audio.hash) return [];
  return [issue("audio-mismatch", "$.audio.hash", `timing was made for ${doc.audio.hash}, but the audio is ${audioHash}`)];
}

function checkWords(doc) {
  const out = [];
  const limit = doc.audio.durationSeconds + DURATION_TOLERANCE_SECONDS + FLOAT_EPSILON;
  doc.words.forEach((w, i) => {
    const p = `$.words[${i}]`;
    if (w.end < w.start) {
      out.push(issue("word-order", `${p}.end`, `word "${w.text}" ends at ${w.end}, before it starts at ${w.start}`));
    }
    const previous = doc.words[i - 1];
    if (previous && w.start < previous.end - WORD_OVERLAP_TOLERANCE_SECONDS - FLOAT_EPSILON) {
      out.push(issue("word-order", `${p}.start`, `word "${w.text}" starts at ${w.start}, before "${previous.text}" ends at ${previous.end}`));
    }
    if (w.end > limit) {
      out.push(issue("out-of-range", `${p}.end`, `word "${w.text}" ends at ${w.end}, after the audio ends at ${doc.audio.durationSeconds}`));
    }
  });
  return out;
}

function checkText(doc) {
  const joined = doc.words.map((w) => w.text).join(" ");
  if (joined === collapse(doc.text)) return [];
  const words = joined.split(" ");
  const text = collapse(doc.text).split(" ");
  const at = words.findIndex((w, i) => w !== text[i]);
  const where = at === -1 ? words.length : at;
  return [issue("text-mismatch", `$.words[${Math.min(where, doc.words.length - 1)}].text`,
    `the words differ from text at word ${where}: "${words[where] ?? "(none)"}" vs "${text[where] ?? "(none)"}"`)];
}

function checkLines(doc) {
  const out = [];
  let previousLast = -1;
  (doc.lines ?? []).forEach((line, i) => {
    const p = `$.lines[${i}]`;
    if (line.firstWord > line.lastWord) {
      out.push(issue("bad-line", `${p}.lastWord`, `line "${line.id}" ends at word ${line.lastWord}, before it starts at ${line.firstWord}`));
    }
    if (line.lastWord >= doc.words.length) {
      out.push(issue("bad-line", `${p}.lastWord`, `line "${line.id}" names word ${line.lastWord}, but there are ${doc.words.length} words`));
    }
    if (line.firstWord <= previousLast) {
      out.push(issue("bad-line", `${p}.firstWord`, `line "${line.id}" starts at word ${line.firstWord}, inside the previous line (ends at ${previousLast})`));
    }
    previousLast = Math.max(previousLast, line.lastWord);
  });
  return out;
}

function checkSpeech(doc) {
  const out = [];
  const limit = doc.audio.durationSeconds + DURATION_TOLERANCE_SECONDS + FLOAT_EPSILON;
  let previousEnd = -Infinity;
  (doc.speech ?? []).forEach(([start, end], i) => {
    const p = `$.speech[${i}]`;
    if (start >= end) out.push(issue("speech-order", p, `speech span ${start}–${end} is empty or reversed`));
    if (start < previousEnd) out.push(issue("speech-order", `${p}[0]`, `speech span starts at ${start}, before the previous one ends at ${previousEnd}`));
    if (end > limit) out.push(issue("out-of-range", `${p}[1]`, `speech span ends at ${end}, after the audio ends at ${doc.audio.durationSeconds}`));
    previousEnd = Math.max(previousEnd, end);
  });
  return out;
}

function checkEnergy(doc) {
  if (!doc.energy) return [];
  const expected = Math.round(doc.audio.durationSeconds * doc.energy.rate);
  const actual = doc.energy.values.length;
  if (Math.abs(actual - expected) <= ENERGY_LENGTH_TOLERANCE_SAMPLES) return [];
  return [issue("energy-length", "$.energy.values",
    `${actual} energy samples at ${doc.energy.rate}/s, but ${doc.audio.durationSeconds} s of audio needs about ${expected}`)];
}

/**
 * Start, end and text of one line, derived from its words.
 * @returns {{id: string, start: number, end: number, text: string, speaker?: string}}
 */
export function lineSpan(doc, index) {
  const line = doc.lines?.[index];
  if (!line) throw new RangeError(`no line at index ${index}`);
  const words = doc.words.slice(line.firstWord, line.lastWord + 1);
  return {
    id: line.id,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((w) => w.text).join(" "),
    ...(line.speaker === undefined ? {} : { speaker: line.speaker }),
  };
}
