// ---------------------------------------------------------------------------
// Narration takes
// ---------------------------------------------------------------------------
// A take is any accepted voice audio, whatever tool made it: a Qwen segment, an
// ElevenLabs block take, a whole recital. Each tool gets its text prepared the
// way it needs (inline tags and pronunciation spellings for ElevenLabs, the
// worker's segmentation and a separate direction for Qwen); the take records
// the written `text` and, verbatim, the `spokenText` the tool received.
//
// A unit — a block of the spec — plays an ordered sequence of takes with
// pauses between them, and may declare scene pauses ("holds") inside a take,
// after a sentence end. The voice is never cut or stretched: a held take plays
// in two pieces around the silence. One take may play in many units.
//
// layoutUnit turns a unit into audio pieces and one sequence of words in unit
// time, which is what cues resolve against. takesFromNarrationManifest maps
// the Qwen narration manifest into takes and one unit, positions unchanged.
// ---------------------------------------------------------------------------

import Ajv2020 from "ajv/dist/2020.js";
import schema from "../schemas/v1alpha1/narration-takes.schema.json" with { type: "json" };
import { jsonPath } from "./edit-timeline.mjs";
import { normalizeWord } from "./cues.mjs";

let compiled = null;

function schemaValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(schema);
    compiled = ajv.getSchema(`${schema.$id}#/$defs/NarrationTakes`);
  }
  return compiled;
}

function issue(code, path, message) {
  return { code, message, path };
}

/**
 * Validate a NarrationTakes document.
 * @returns {{code: string, message: string, path: string}[]} every problem; empty when valid.
 */
export function validateNarrationTakes(doc) {
  const validate = schemaValidator();
  if (!validate(doc)) {
    return validate.errors.map((e) =>
      issue("schema", jsonPath(e.instancePath), `${e.instancePath || "/"} ${e.message}`),
    );
  }
  const out = [];
  const duplicates = (items, kind, base) => {
    const seen = new Map();
    items.forEach((item, i) => {
      if (seen.has(item.id)) out.push(issue("duplicate-id", `${base}[${i}].id`, `${kind} id "${item.id}" is already used at ${base}[${seen.get(item.id)}]`));
      else seen.set(item.id, i);
    });
  };
  duplicates(doc.takes, "take", "$.takes");
  duplicates(doc.units, "unit", "$.units");
  const takeIds = new Set(doc.takes.map((t) => t.id));
  doc.units.forEach((unit, ui) => {
    unit.sequence.forEach((entry, ei) => {
      const p = `$.units[${ui}].sequence[${ei}]`;
      if (!takeIds.has(entry.take)) out.push(issue("unknown-take", `${p}.take`, `unit "${unit.id}" plays take "${entry.take}", which is not in takes`));
      if (ei === 0 && entry.pauseBefore !== undefined) {
        out.push(issue("bad-pause", `${p}.pauseBefore`, `the first take of unit "${unit.id}" cannot have a pause before it`));
      }
      if (ei > 0 && entry.pauseBefore === undefined) {
        out.push(issue("bad-pause", p, `take "${entry.take}" in unit "${unit.id}" needs a pauseBefore: there is no default`));
      }
    });
  });
  return out;
}

const SENTENCE_END = /[.!?:]$/;

/** Times are kept to the microsecond, as the agent's narration manifest does: no 5.668999999999997. */
const us = (seconds) => Number(seconds.toFixed(6));

/** Where to split a take for a hold, or a problem. */
function holdSplit(hold, timing, path) {
  const key = normalizeWord(hold.afterWord);
  const n = hold.n ?? 1;
  const hits = timing.words.map((w, i) => (normalizeWord(w.text) === key ? i : -1)).filter((i) => i >= 0);
  if (hits.length < n) {
    return { problem: issue("bad-hold", `${path}.afterWord`, `"${hold.afterWord}"${n > 1 ? ` #${n}` : ""} is said ${hits.length} time${hits.length === 1 ? "" : "s"} in take "${timing.take.id}"`) };
  }
  const i = hits[n - 1];
  const word = timing.words[i];
  if (!SENTENCE_END.test(word.text)) {
    return { problem: issue("bad-hold", `${path}.afterWord`, `"${word.text}" does not end a sentence: a scene pause only follows . ! ? or :`) };
  }
  if (i === timing.words.length - 1) {
    return { problem: issue("bad-hold", `${path}.afterWord`, `"${word.text}" is the last word of take "${timing.take.id}": use the pause before the next take instead`) };
  }
  return { at: (word.end + timing.words[i + 1].start) / 2, word: i };
}

/**
 * Lay out one unit: audio pieces, words and lines in unit time, energy.
 * `doc` must already pass validateNarrationTakes; `timings` maps take id → valid WordTiming.
 * @returns {{layout: object} | {problems: {code: string, message: string, path: string}[]}}
 */
export function layoutUnit(doc, unitId, timings) {
  const ui = doc.units.findIndex((u) => u.id === unitId);
  if (ui === -1) throw new RangeError(`no unit "${unitId}"`);
  const unit = doc.units[ui];
  const takes = new Map(doc.takes.map((t) => [t.id, t]));
  const problems = [];
  const pieces = [];
  const words = [];
  const lines = [];
  const energies = [];
  let cursor = 0;

  unit.sequence.forEach((entry, ei) => {
    const p = `$.units[${ui}].sequence[${ei}]`;
    const take = takes.get(entry.take);
    const timing = timings?.[entry.take];
    if (!timing) {
      problems.push(issue("missing-timing", `${p}.take`, `take "${entry.take}" has no WordTiming: its words cannot be placed`));
      return;
    }
    if (timing.audio.hash !== take.audio.hash) {
      problems.push(issue("timing-mismatch", `${p}.take`, `the WordTiming given for "${entry.take}" was made for ${timing.audio.hash}, not ${take.audio.hash}`));
      return;
    }
    if (timing.text !== take.text) {
      problems.push(issue("timing-mismatch", `${p}.take`, `the WordTiming given for "${entry.take}" reproduces another text`));
      return;
    }
    const splits = [];
    (entry.holds ?? []).forEach((hold, hi) => {
      const split = holdSplit(hold, timing, `${p}.holds[${hi}]`);
      if (split.problem) problems.push(split.problem);
      else if (splits.some((s) => s.word === split.word)) {
        // Two pauses after one word would leave an empty piece of voice between them: declare one, longer.
        problems.push(issue("bad-hold", `${p}.holds[${hi}].afterWord`, `"${hold.afterWord}" already has a scene pause in this playing of "${entry.take}"`));
      } else splits.push({ at: split.at, word: split.word, seconds: hold.seconds });
    });
    splits.sort((a, b) => a.at - b.at);

    cursor += entry.pauseBefore ?? 0;
    const start = cursor;
    const shift = (t) => t + splits.filter((s) => t >= s.at).reduce((sum, s) => sum + s.seconds, 0);

    const firstPiece = pieces.length;
    let from = 0;
    let placed = 0;
    for (const split of splits) {
      pieces.push({ take: entry.take, at: us(start + from + placed), from: us(from), duration: us(split.at - from) });
      placed += split.seconds;
      from = split.at;
    }
    pieces.push({ take: entry.take, at: us(start + from + placed), from: us(from), duration: us(take.audio.durationSeconds - from) });

    const firstWord = words.length;
    for (const w of timing.words) {
      words.push({ ...w, start: us(start + shift(w.start)), end: us(start + shift(w.start) + (w.end - w.start)) });
    }
    for (const line of timing.lines ?? []) {
      lines.push({ ...line, firstWord: line.firstWord + firstWord, lastWord: line.lastWord + firstWord });
    }
    energies.push(timing.energy ? { energy: timing.energy, pieces: pieces.slice(firstPiece) } : null);

    cursor = start + take.audio.durationSeconds + placed;
  });

  if (problems.length > 0) return { problems };
  const layout = { durationSeconds: us(cursor), pieces, timing: { take: { id: unit.id }, words, lines } };
  const energy = joinEnergy(energies, cursor);
  if (energy) layout.energy = energy;
  return { layout };
}

/** One envelope for the unit: each piece's slice of its take's energy, zeros in every silence. */
function joinEnergy(energies, durationSeconds) {
  if (energies.length === 0 || energies.some((e) => e === null)) return null;
  const rate = energies[0].energy.rate;
  if (energies.some((e) => e.energy.rate !== rate)) return null;
  const values = new Array(Math.round(durationSeconds * rate)).fill(0);
  for (const { energy, pieces } of energies) {
    for (const piece of pieces) {
      const slice = energy.values.slice(Math.round(piece.from * rate), Math.round((piece.from + piece.duration) * rate));
      const at = Math.round(piece.at * rate);
      slice.forEach((v, i) => {
        if (at + i < values.length) values[at + i] = v;
      });
    }
  }
  return { rate, values };
}

/** The provider name the Qwen mapping records. */
export const QWEN_PROVIDER = "qwen3-tts-local";

/**
 * Map a Qwen narration manifest (canonical or the agent's lighter shape) into
 * takes and one unit, "narration", whose positions equal the manifest's.
 * @param {object} manifest
 * @param {{segments?: object[]}} [options] NarrationSegment records, for text, role and language
 * @returns {{takes: object, leadInSeconds: number}}
 */
export function takesFromNarrationManifest(manifest, { segments = [] } = {}) {
  const bySegment = new Map(segments.map((s) => [s.segmentId, s]));
  const captions = new Map();
  for (const c of manifest.captions ?? []) if (!captions.has(c.segmentId)) captions.set(c.segmentId, c.text);
  const missing = manifest.entries.map((e) => e.segmentId).filter((id) => !bySegment.has(id) && !captions.has(id));
  if (missing.length > 0) throw new Error(`no text for segments: ${missing.join(", ")}`);

  const takes = manifest.entries.map((entry) => {
    const segment = bySegment.get(entry.segmentId);
    const text = segment ? segment.displayText : captions.get(entry.segmentId);
    const take = {
      id: entry.segmentId,
      audio: { path: entry.wav.path, hash: entry.wav.contentHash, durationSeconds: entry.wav.durationSeconds },
      text,
      voice: { provider: QWEN_PROVIDER },
    };
    if (segment && segment.spokenText !== segment.displayText) take.spokenText = segment.spokenText;
    if (segment?.role) take.role = segment.role;
    if (segment?.language) take.language = segment.language;
    take.source = { segmentId: entry.segmentId, ...(entry.acceptedAttemptId ? { attemptId: entry.acceptedAttemptId } : {}) };
    return take;
  });
  const sequence = manifest.entries.map((entry, i) =>
    // A missing pauseAfterMs is no pause, as the agent writes it (Math.max(0, … ?? 0)).
    i === 0 ? { take: entry.segmentId } : { take: entry.segmentId, pauseBefore: (manifest.entries[i - 1].pauseAfterMs ?? 0) / 1000 },
  );
  const doc = { apiVersion: "studio.video/v1alpha1", kind: "NarrationTakes", takes, units: [{ id: "narration", sequence }] };
  // Return valid takes or nothing: a pause beyond 10 s or an id the contract does not allow ends here.
  const problems = validateNarrationTakes(doc);
  if (problems.length > 0) {
    throw new Error(`not valid narration takes: ${problems.map((p) => `${p.code} at ${p.path}`).join("; ")}`);
  }
  return { takes: doc, leadInSeconds: manifest.leadInSilenceSeconds ?? 0 };
}
