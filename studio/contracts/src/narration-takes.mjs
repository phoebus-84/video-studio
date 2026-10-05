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
