# Narration Takes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the provider-neutral `NarrationTakes` contract — a registry of voice takes from any tool and the sequences each unit plays, with pauses and scene pauses — plus `layoutUnit` (audio pieces and unit-time words that cues resolve against) and a mapping from today's Qwen narration manifest that keeps its positions unchanged.

**Architecture:** `schemas/v1alpha1/narration-takes.schema.json` owns the shape. `src/narration-takes.mjs` validates it (schema first, then ids, references, pauses), lays a unit out (pieces, shifted words and lines, joined energy, holds split at the midpoint between two words), and maps a Qwen manifest into takes and one unit. Hold words match with `normalizeWord` from `cues.mjs`; the cue scope type becomes structural so a unit's timing works like a take's.

**Tech Stack:** Node 22 ESM, JSON Schema 2020-12, Ajv 8 strict, `node:test`, the repo's bindings generator.

**Spec:** `docs/superpowers/specs/2026-10-05-narration-takes-design.md`

## Global Constraints

- `$id` exactly `https://video.studio/schemas/v1alpha1/narration-takes.schema.json`; `kind` `NarrationTakes`; `apiVersion` `studio.video/v1alpha1`.
- Text preparation follows the tool: `spokenText` is recorded verbatim, never interpreted; `voice` is provenance only. Nothing assumes ElevenLabs or Qwen.
- `pauseBefore` 0–10 s, required from the second sequence entry on, forbidden on the first; no default anywhere.
- Holds: after a word whose written text ends with `.`, `!`, `?` or `:`, not the last word, 0.5–4 s, non-empty `reason`; split at the midpoint between that word's end and the next word's start; the voice is never cut or stretched.
- Problem codes exactly: `schema`, `duplicate-id`, `unknown-take`, `bad-pause` (validation); `missing-timing`, `timing-mismatch`, `bad-hold` (layout). An unknown unit throws `RangeError`; a manifest segment with no text throws `Error`.
- Layout times are rounded to the microsecond (`Number(x.toFixed(6))`), like the agent's narration manifest.
- The Qwen mapping provider name is `qwen3-tts-local`; the Qwen worker, manifest, segmentation and mastering are not modified.
- `@studio/contracts` 0.4.0 → 0.5.0.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- The same take played twice in one unit must lay out both playings, each with its own energy slice — the energy code slices pieces by index, not by take id. Not covered by a fixture; check `layoutUnit` reasoning.
- Two holds in one take must both split and accumulate their shifts — the code sorts splits and sums `seconds` for every split before a word; no fixture has two holds.
- A take whose `WordTiming` has energy at another rate than the other takes must drop the unit's energy, not mix rates — `joinEnergy` checks one rate.
- The Qwen mapping with `pauseAfterMs` on the last entry: it is ignored (nothing follows inside the unit), exactly as the agent's last caption ignores it.
- `pauseBefore: 0` on a later entry is valid (explicit zero), and must not be confused with "missing" — validation tests `=== undefined`.

## File map

| File | Responsibility | Task |
|---|---|---|
| `studio/contracts/schemas/v1alpha1/narration-takes.schema.json` | Shape | 1 |
| `studio/contracts/fixtures/narration-takes/valid/il-lampo.json`, `invalid/*.json` | Real takes, one broken rule each | 1 |
| `studio/contracts/src/narration-takes.mjs` + `.d.mts` | Validation (1), layout (2), Qwen mapping (3) | 1–3 |
| `studio/contracts/scripts/check-narration-takes-fixtures.mjs` | Fixture check | 1 |
| `studio/contracts/bindings/ts/narration-takes.ts` | Generated | 1 |
| `studio/contracts/test/narration-takes.test.mjs` | Tests, one suite per task | 1–3 |
| `studio/contracts/src/cues.d.mts` | Structural `CueTiming` | 2 |
| `studio/contracts/package.json`, `bun.lock`, `README.md`, `docs/contract-catalog.md` | Wiring, version, docs | 4 |

Commands run from the repository root unless a step says otherwise. Work on branch `feat/narration-takes` (already created; the spec is committed there).

---

### Task 1: Schema, fixtures, validation and bindings

**Files:**
- Create: `studio/contracts/schemas/v1alpha1/narration-takes.schema.json`
- Create: `studio/contracts/fixtures/narration-takes/valid/il-lampo.json`, 7 files in `fixtures/narration-takes/invalid/`
- Create: `studio/contracts/src/narration-takes.mjs`, `studio/contracts/src/narration-takes.d.mts`
- Create: `studio/contracts/scripts/check-narration-takes-fixtures.mjs`
- Create: `studio/contracts/test/narration-takes.test.mjs`
- Modify: `studio/contracts/test/bindings.test.mjs`
- Generated: `studio/contracts/bindings/ts/narration-takes.ts`

**Interfaces:**
- Consumes: `jsonPath` (`src/edit-timeline.mjs`), `applyPatch` (`scripts/lib/json-patch.mjs`), the word-timing fixtures (their texts and hashes are copied into `il-lampo.json`).
- Produces: `validateNarrationTakes(doc)`; the fixture `il-lampo.json` with takes `epoca` (index 0) and `recitazione` (index 1) and units `ascolto1`(0), `epoca`(1, hold after "temporale."), `doppio`(2, epoca then recitazione with `pauseBefore` 0.32), `ascolto2`(3) — Tasks 2 and 3 rely on those indices; binding `NarrationTakes`.

- [ ] **Step 1: Write the fixtures, the check script and the failing tests**

Create `studio/contracts/fixtures/narration-takes/valid/il-lampo.json` (texts and hashes copied from the word-timing fixtures; the two `timing.hash` values are the sha256 of those fixture files):

```json
{
  "apiVersion": "studio.video/v1alpha1",
  "kind": "NarrationTakes",
  "takes": [
    {
      "id": "epoca",
      "audio": {
        "path": "assets/takes/epoca.mp3",
        "hash": "sha256:f6a2b821d310658eefa4aac4fbe231c1e12e13099ba26bd377227487733d0013",
        "durationSeconds": 47.833
      },
      "text": "Prima di entrare nei versi, guardiamo gli anni in cui nascono. Il lampo esce nel milleottocentonovantaquattro, nella terza edizione di Myricae. L'Italia è unita da poco più di trent'anni, ed è un paese povero: più di un italiano su due non sa né leggere né scrivere. Ogni anno, centinaia di migliaia di persone emigrano, molte verso le Americhe, in cerca di lavoro. Nelle campagne crescono le proteste: in Sicilia i Fasci dei lavoratori chiedono pane e terra, e all'inizio del milleottocentonovantaquattro il governo di Francesco Crispi risponde con lo stato d'assedio. È un'epoca di tensioni e di paure, carica come un cielo prima del temporale. E Pascoli porta dentro anche un temporale tutto suo. Riguarda suo padre, Ruggero.",
      "spokenText": "Prima di entrare nei versi, guardiamo gli anni in cui nascono. Il lampo esce nel milleottocentonovantaquattro, nella terza edizione di Mirìce. L'Italia è unita da poco più di trent'anni, ed è un paese povero: più di un italiano su due non sa né leggere né scrivere. Ogni anno, centinaia di migliaia di persone emigrano, molte verso le Americhe, in cerca di lavoro. Nelle campagne crescono le proteste: in Sicilia i Fasci dei lavoratori chiedono pane e terra, e all'inizio del milleottocentonovantaquattro il governo di Francesco Crispi risponde con lo stato d'assedio. È un'epoca di tensioni e di paure, carica come un cielo prima del temporale. E Pascoli porta dentro anche un temporale tutto suo. Riguarda suo padre, Ruggero.",
      "role": "guide",
      "language": "it",
      "voice": {
        "provider": "elevenlabs",
        "model": "eleven_turbo_v2_5",
        "voiceId": "fQmr8dTaOQq116mo2X7F",
        "settings": {
          "stability": 0.6,
          "similarity_boost": 0.75,
          "style": 0.1
        }
      },
      "timing": {
        "path": "artifacts/timing/epoca.json",
        "hash": "sha256:84a1a7dbc36b8c25287706522b5431b964c29306b7cd366d49522928678811a8"
      }
    },
    {
      "id": "recitazione",
      "audio": {
        "path": "assets/takes/san-martino.wav",
        "hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "durationSeconds": 32.233
      },
      "text": "La nebbia agli irti colli piovigginando sale, e sotto il maestrale urla e biancheggia il mar; ma per le vie del borgo dal ribollir de’ tini va l’aspro odor de i vini l’anime a rallegrar. Gira su’ ceppi accesi lo spiedo scoppiettando: sta il cacciator fischiando su l’uscio a rimirar tra le rossastre nubi stormi d’uccelli neri, com’esuli pensieri, nel vespero migrar.",
      "spokenText": "[warm, unhurried legato recitation in native Italian] La nebbia agli irti colli piovigginando sale, e sotto il maestrale urla e biancheggia il mar; ma per le vie del borgo dal ribollir de’ tini va l’aspro odor de i vini l’anime a rallegrar. Gira su’ ceppi accesi lo spiedo scoppiettando: sta il cacciator fischiando su l’uscio a rimirar tra le rossastre nubi stormi d’uccelli neri, com’esuli pensieri, nel vespero migrar.",
      "role": "recitante",
      "language": "it",
      "voice": {
        "provider": "elevenlabs",
        "model": "eleven_v3",
        "voiceId": "ts9siqBZkKbGEMralWeB",
        "settings": {
          "stability": 0.5
        }
      },
      "timing": {
        "path": "artifacts/timing/recitazione.json",
        "hash": "sha256:99cb0d7a33f5a2c70967ee11c7d713d3166668c9f14dec230e9609f76ee8eee6"
      }
    }
  ],
  "units": [
    {
      "id": "ascolto1",
      "source": "blocks[2]",
      "sequence": [
        {
          "take": "recitazione"
        }
      ]
    },
    {
      "id": "epoca",
      "source": "blocks[3]",
      "sequence": [
        {
          "take": "epoca",
          "holds": [
            {
              "afterWord": "temporale.",
              "seconds": 2.5,
              "reason": "togliamo il suono: silenzio vero"
            }
          ]
        }
      ]
    },
    {
      "id": "doppio",
      "source": "blocks[9]",
      "sequence": [
        {
          "take": "epoca"
        },
        {
          "take": "recitazione",
          "pauseBefore": 0.32
        }
      ]
    },
    {
      "id": "ascolto2",
      "source": "blocks[14]",
      "sequence": [
        {
          "take": "recitazione"
        }
      ]
    }
  ],
  "metadata": {
    "note": "takes from CreativeStudio Il lampo (epoca, real hash) and San Martino (recital, synthetic hash); timing hashes are those of the word-timing fixture files"
  }
}
```

Create these 7 files in `studio/contracts/fixtures/narration-takes/invalid/`:

`duplicate-take-id.json`:

```json
{
  "expect": "duplicate-id",
  "base": "il-lampo.json",
  "patch": [
    {
      "op": "replace",
      "path": "/takes/1/id",
      "value": "epoca"
    },
    {
      "op": "replace",
      "path": "/units/0/sequence/0/take",
      "value": "epoca"
    },
    {
      "op": "replace",
      "path": "/units/2/sequence/1/take",
      "value": "epoca"
    },
    {
      "op": "replace",
      "path": "/units/3/sequence/0/take",
      "value": "epoca"
    }
  ]
}
```

`duplicate-unit-id.json`:

```json
{
  "expect": "duplicate-id",
  "base": "il-lampo.json",
  "patch": [
    {
      "op": "replace",
      "path": "/units/3/id",
      "value": "ascolto1"
    }
  ]
}
```

`hold-too-long.json`:

```json
{
  "expect": "schema",
  "base": "il-lampo.json",
  "patch": [
    {
      "op": "replace",
      "path": "/units/1/sequence/0/holds/0/seconds",
      "value": 5
    }
  ]
}
```

`hold-without-reason.json`:

```json
{
  "expect": "schema",
  "base": "il-lampo.json",
  "patch": [
    {
      "op": "remove",
      "path": "/units/1/sequence/0/holds/0/reason"
    }
  ]
}
```

`pause-missing.json`:

```json
{
  "expect": "bad-pause",
  "base": "il-lampo.json",
  "patch": [
    {
      "op": "remove",
      "path": "/units/2/sequence/1/pauseBefore"
    }
  ]
}
```

`pause-on-first-take.json`:

```json
{
  "expect": "bad-pause",
  "base": "il-lampo.json",
  "patch": [
    {
      "op": "add",
      "path": "/units/0/sequence/0/pauseBefore",
      "value": 0.5
    }
  ]
}
```

`unknown-take.json`:

```json
{
  "expect": "unknown-take",
  "base": "il-lampo.json",
  "patch": [
    {
      "op": "replace",
      "path": "/units/1/sequence/0/take",
      "value": "genesi"
    }
  ]
}
```

Create `studio/contracts/scripts/check-narration-takes-fixtures.mjs`:

```js
#!/usr/bin/env node

/**
 * Validate narration-takes fixtures: every valid fixture has no problem; every
 * invalid fixture (a valid base plus a patch) fails with exactly its code.
 * Usage: node scripts/check-narration-takes-fixtures.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateNarrationTakes } from "../src/narration-takes.mjs";
import { applyPatch } from "./lib/json-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "fixtures/narration-takes");
const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));
const valid = readdirSync(resolve(dir, "valid")).filter((f) => f.endsWith(".json"));
const invalid = readdirSync(resolve(dir, "invalid")).filter((f) => f.endsWith(".json"));

let failures = 0;

for (const file of valid) {
  const problems = validateNarrationTakes(readJson(resolve(dir, "valid", file)));
  if (problems.length > 0) {
    failures += 1;
    console.error(`FAIL valid ${file}:`, problems.map((p) => `${p.code} ${p.path}`).join("; "));
  } else {
    console.log(`PASS valid ${file}`);
  }
}

for (const file of invalid) {
  const fixture = readJson(resolve(dir, "invalid", file));
  const doc = applyPatch(readJson(resolve(dir, "valid", fixture.base)), fixture.patch);
  const found = [...new Set(validateNarrationTakes(doc).map((p) => p.code))];
  if (found.length !== 1 || found[0] !== fixture.expect) {
    failures += 1;
    console.error(`FAIL invalid ${file}: expected [${fixture.expect}], got [${found.join(", ")}]`);
  } else {
    console.log(`PASS invalid ${file} rejected with ${fixture.expect}`);
  }
}

if (failures) {
  console.error(`\n${failures} narration-takes check(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${valid.length} valid and ${invalid.length} invalid narration-takes fixtures passed`);
}
```

Create `studio/contracts/test/narration-takes.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateNarrationTakes } from "../src/narration-takes.mjs";
import { applyPatch } from "../scripts/lib/json-patch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "fixtures/narration-takes");
const read = (path) => JSON.parse(readFileSync(resolve(root, path), "utf-8"));
const doc = () => read("fixtures/narration-takes/valid/il-lampo.json");
const timings = () => ({
  epoca: read("fixtures/word-timing/valid/epoca-take.json"),
  recitazione: read("fixtures/word-timing/valid/san-martino-recital.json"),
});
const codes = (problems) => [...new Set(problems.map((p) => p.code))].sort();

describe("validateNarrationTakes", () => {
  it("accepts the Il lampo fixture", () => {
    assert.deepEqual(validateNarrationTakes(doc()), []);
  });

  it("rejects every invalid fixture with exactly its expected code", () => {
    for (const file of readdirSync(resolve(dir, "invalid"))) {
      const fixture = JSON.parse(readFileSync(resolve(dir, "invalid", file), "utf-8"));
      const broken = applyPatch(JSON.parse(readFileSync(resolve(dir, "valid", fixture.base), "utf-8")), fixture.patch);
      assert.deepEqual(codes(validateNarrationTakes(broken)), [fixture.expect], file);
    }
  });

  it("collects every problem with its path", () => {
    const d = doc();
    d.units[1].sequence[0].take = "genesi";
    delete d.units[2].sequence[1].pauseBefore;
    assert.deepEqual(validateNarrationTakes(d).map((p) => [p.code, p.path]), [
      ["unknown-take", "$.units[1].sequence[0].take"],
      ["bad-pause", "$.units[2].sequence[1]"],
    ]);
  });
});
```

Append inside the `describe("TypeScript bindings", …)` block of `studio/contracts/test/bindings.test.mjs`, before its closing `});`:

```js
  it("generates the narration takes contract", () => {
    const content = readBinding("narration-takes");
    assert.ok(content.includes("export interface NarrationTakes {"));
    assert.ok(content.includes("holds?: Hold[];"));
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd studio/contracts && node --test test/narration-takes.test.mjs test/bindings.test.mjs 2>&1 | grep -E "Cannot find module|ENOENT|^# fail"`
Expected: `Cannot find module '…/src/narration-takes.mjs'` and the bindings test failing on `ENOENT … narration-takes.ts`.

- [ ] **Step 3: Create the schema**

Create `studio/contracts/schemas/v1alpha1/narration-takes.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://video.studio/schemas/v1alpha1/narration-takes.schema.json",
  "title": "Video Studio narration takes schema",
  "description": "Every accepted voice take of an episode, whatever tool made it, and what each unit of the spec plays: an ordered sequence of takes with pauses and declared scene pauses. Text preparation follows the tool; spokenText records exactly what the tool received. Checked by validateNarrationTakes and laid out by layoutUnit in src/narration-takes.mjs.",
  "$defs": {
    "ContentHash": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}$"
    },
    "LocalId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*$"
    },
    "AudioRef": {
      "type": "object",
      "additionalProperties": false,
      "required": ["path", "hash", "durationSeconds"],
      "properties": {
        "path": { "type": "string", "minLength": 1 },
        "hash": { "$ref": "#/$defs/ContentHash" },
        "durationSeconds": { "type": "number", "exclusiveMinimum": 0 }
      }
    },
    "Voice": {
      "type": "object",
      "additionalProperties": false,
      "required": ["provider"],
      "description": "Provenance only: what made the take. The contract interprets none of it.",
      "properties": {
        "provider": { "type": "string", "minLength": 1, "description": "Open vocabulary, e.g. elevenlabs, qwen3-tts-local." },
        "model": { "type": "string", "minLength": 1 },
        "voiceId": { "type": "string", "minLength": 1 },
        "settings": { "type": "object", "description": "Provider parameters, recorded as sent." },
        "direction": { "type": "string", "minLength": 1, "description": "An instruction sent separately from the text, e.g. Qwen's composed direction." }
      }
    },
    "FileRef": {
      "type": "object",
      "additionalProperties": false,
      "required": ["path", "hash"],
      "properties": {
        "path": { "type": "string", "minLength": 1 },
        "hash": { "$ref": "#/$defs/ContentHash" }
      }
    },
    "TakeSource": {
      "type": "object",
      "additionalProperties": false,
      "description": "The narration manifest entry this take came from.",
      "properties": {
        "segmentId": { "type": "string", "minLength": 1 },
        "attemptId": { "type": "string", "minLength": 1 }
      }
    },
    "Take": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "audio", "text", "voice"],
      "properties": {
        "id": { "$ref": "#/$defs/LocalId" },
        "audio": { "$ref": "#/$defs/AudioRef" },
        "text": { "type": "string", "minLength": 1, "description": "The written text: on screen, matched by cues, reproduced by the take's WordTiming." },
        "spokenText": { "type": "string", "minLength": 1, "description": "Exactly what the tool received, in its own format (tags, pronunciation spellings…)." },
        "role": { "type": "string", "minLength": 1 },
        "language": { "type": "string", "pattern": "^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$" },
        "voice": { "$ref": "#/$defs/Voice" },
        "timing": { "$ref": "#/$defs/FileRef", "description": "The take's WordTiming file." },
        "source": { "$ref": "#/$defs/TakeSource" }
      }
    },
    "Hold": {
      "type": "object",
      "additionalProperties": false,
      "required": ["afterWord", "seconds", "reason"],
      "description": "A declared scene pause inside the take, after a word that ends a sentence.",
      "properties": {
        "afterWord": { "type": "string", "pattern": "^\\S+$" },
        "n": { "type": "integer", "minimum": 1 },
        "seconds": { "type": "number", "minimum": 0.5, "maximum": 4 },
        "reason": { "type": "string", "pattern": "\\S" }
      }
    },
    "SequenceEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": ["take"],
      "properties": {
        "take": { "$ref": "#/$defs/LocalId" },
        "pauseBefore": { "type": "number", "minimum": 0, "maximum": 10, "description": "Seconds of silence before this take; required from the second entry on, forbidden on the first." },
        "holds": { "type": "array", "items": { "$ref": "#/$defs/Hold" } }
      }
    },
    "Unit": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "sequence"],
      "properties": {
        "id": { "$ref": "#/$defs/LocalId" },
        "source": { "type": "string", "minLength": 1, "description": "JSON path into the spec." },
        "sequence": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/SequenceEntry" } }
      }
    },
    "NarrationTakes": {
      "type": "object",
      "additionalProperties": false,
      "required": ["apiVersion", "kind", "takes", "units"],
      "properties": {
        "apiVersion": { "type": "string", "const": "studio.video/v1alpha1" },
        "kind": { "type": "string", "const": "NarrationTakes" },
        "takes": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/Take" } },
        "units": { "type": "array", "items": { "$ref": "#/$defs/Unit" } },
        "metadata": { "type": "object" }
      }
    }
  }
}
```

- [ ] **Step 4: Implement validation**

Create `studio/contracts/src/narration-takes.mjs`:

```js
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
```

Create `studio/contracts/src/narration-takes.d.mts`:

```ts
// Type declarations for narration takes (avg-7zp.4).
// The document types are generated from the schema into bindings/ts/narration-takes.ts.

export type NarrationTakesProblemCode =
  | "schema"
  | "duplicate-id"
  | "unknown-take"
  | "bad-pause"
  | "missing-timing"
  | "timing-mismatch"
  | "bad-hold";

export interface NarrationTakesProblem {
  code: NarrationTakesProblemCode;
  message: string;
  path: string;
}

/** Every problem in `doc`; an empty array means the document is valid. */
export declare function validateNarrationTakes(doc: unknown): NarrationTakesProblem[];
```

- [ ] **Step 5: Generate the binding and run the tests**

Run: `cd studio/contracts && npm run bindings:generate && git status --short bindings && node --test test/narration-takes.test.mjs test/bindings.test.mjs 2>&1 | grep -E "^# (pass|fail)" && node scripts/check-narration-takes-fixtures.mjs | tail -1 && npm run bindings:check`
Expected: only `?? bindings/ts/narration-takes.ts`; `# fail 0`; `1 valid and 7 invalid narration-takes fixtures passed`; `PASS TypeScript bindings are up to date`.

- [ ] **Step 6: Commit**

```bash
git add studio/contracts/schemas/v1alpha1/narration-takes.schema.json studio/contracts/fixtures/narration-takes \
  studio/contracts/src/narration-takes.mjs studio/contracts/src/narration-takes.d.mts \
  studio/contracts/scripts/check-narration-takes-fixtures.mjs studio/contracts/bindings/ts/narration-takes.ts \
  studio/contracts/test/narration-takes.test.mjs studio/contracts/test/bindings.test.mjs
git commit -m "feat(contracts): narration takes schema, fixtures and validation (avg-7zp.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `layoutUnit`

**Files:**
- Modify: `studio/contracts/src/narration-takes.mjs` (one import, append the layout)
- Modify: `studio/contracts/src/narration-takes.d.mts` (imports, append layout types)
- Modify: `studio/contracts/src/cues.d.mts` (structural `CueTiming`)
- Modify: `studio/contracts/test/narration-takes.test.mjs` (imports, append the layout suite)

**Interfaces:**
- Consumes: Task 1's module and fixture; `normalizeWord` and `resolveCue` (`src/cues.mjs`); the word-timing fixtures (epoca word 104 "temporale." 41.249–41.935, word 105 "E" starts 42.393, word 20 "Myricae." with `spoken`; recital 62 words, 8 lines, line 3 ends 14.09, word 0 "La" 4.09–4.17).
- Produces: `layoutUnit(doc, unitId, timings) → { layout } | { problems }`, `layout = { durationSeconds, pieces, timing, energy? }`; `CueTiming` in `cues.d.mts`. Task 3 uses `layoutUnit` to prove positions.

- [ ] **Step 1: Write the failing tests**

In `studio/contracts/test/narration-takes.test.mjs`, replace

```js
import { validateNarrationTakes } from "../src/narration-takes.mjs";
```

with

```js
import { layoutUnit, validateNarrationTakes } from "../src/narration-takes.mjs";
import { resolveCue } from "../src/cues.mjs";
```

and append:

```js
describe("layoutUnit", () => {
  it("lays out a single whole take", () => {
    const { layout } = layoutUnit(doc(), "ascolto1", timings());
    assert.equal(layout.durationSeconds, 32.233);
    assert.deepEqual(layout.pieces, [{ take: "recitazione", at: 0, from: 0, duration: 32.233 }]);
    assert.equal(layout.timing.take.id, "ascolto1");
    assert.equal(layout.timing.words.length, 62);
    assert.equal(layout.timing.lines.length, 8);
    assert.equal(layout.energy.values.length, 967);
  });

  it("plays a reused take identically in another unit", () => {
    const one = layoutUnit(doc(), "ascolto1", timings()).layout;
    const two = layoutUnit(doc(), "ascolto2", timings()).layout;
    assert.deepEqual({ ...two, timing: { ...two.timing, take: one.timing.take } }, one);
  });

  it("splits a held take in two pieces around the silence", () => {
    const { layout } = layoutUnit(doc(), "epoca", timings());
    // "temporale." ends 41.935, "E" starts 42.393: split at 42.164, 2.5 s of silence
    assert.deepEqual(layout.pieces, [
      { take: "epoca", at: 0, from: 0, duration: 42.164 },
      { take: "epoca", at: 44.664, from: 42.164, duration: 5.669 },
    ]);
    assert.equal(layout.durationSeconds, 50.333);
    assert.deepEqual(layout.timing.words[104], { text: "temporale.", start: 41.249, end: 41.935 });
    assert.deepEqual(layout.timing.words[105], { text: "E", start: 44.893, end: 45.075 });
    assert.deepEqual(layout.timing.words[20], { text: "Myricae.", spoken: "Mirìce.", start: 8.106, end: 8.628 });
  });

  it("puts silence in the energy where the hold is", () => {
    const { layout } = layoutUnit(doc(), "epoca", timings());
    assert.equal(layout.energy.rate, 30);
    assert.equal(layout.energy.values.length, Math.round(50.333 * 30));
    const silence = layout.energy.values.slice(Math.round(42.164 * 30), Math.round(44.664 * 30));
    assert.ok(silence.length > 70 && silence.every((v) => v === 0));
  });

  it("chains two takes with the pause before the second", () => {
    const { layout } = layoutUnit(doc(), "doppio", timings());
    assert.deepEqual(layout.pieces, [
      { take: "epoca", at: 0, from: 0, duration: 47.833 },
      { take: "recitazione", at: 48.153, from: 0, duration: 32.233 },
    ]);
    assert.equal(layout.durationSeconds, 80.386);
    assert.equal(layout.timing.words.length, 118 + 62);
    assert.deepEqual(layout.timing.words[118], { text: "La", start: 52.243, end: 52.323 }); // 48.153 + 4.09
    assert.deepEqual(layout.timing.lines[0], { id: "c1", firstWord: 118, lastWord: 124, speaker: "recitante" });
  });

  it("omits energy when one take has none", () => {
    const t = timings();
    delete t.epoca.energy;
    const { layout } = layoutUnit(doc(), "doppio", t);
    assert.equal(layout.energy, undefined);
  });

  it("lets cues resolve on the words of a whole unit", () => {
    const { layout } = layoutUnit(doc(), "doppio", timings());
    const scope = { timing: layout.timing, startSeconds: 10, fps: 30 };
    assert.equal(resolveCue({ word: "temporale" }, scope).frame, Math.round((10 + 41.249) * 30));
    assert.equal(resolveCue({ line: 3, at: "end" }, scope).frame, Math.round((10 + 48.153 + 14.09) * 30));
  });

  it("refuses a take without its WordTiming", () => {
    const t = timings();
    delete t.recitazione;
    assert.deepEqual(layoutUnit(doc(), "doppio", t).problems.map((p) => [p.code, p.path]), [
      ["missing-timing", "$.units[2].sequence[1].take"],
    ]);
  });

  it("refuses a WordTiming made for another file or another text", () => {
    const otherFile = timings();
    otherFile.epoca.audio.hash = `sha256:${"9".repeat(64)}`;
    assert.deepEqual(codes(layoutUnit(doc(), "epoca", otherFile).problems), ["timing-mismatch"]);
    const otherText = timings();
    otherText.epoca.text = otherText.epoca.text.replace("Prima", "Dopo");
    assert.deepEqual(codes(layoutUnit(doc(), "epoca", otherText).problems), ["timing-mismatch"]);
  });

  it("refuses a hold after a missing word, mid-sentence, or after the last word", () => {
    for (const afterWord of ["nuvola.", "lampo", "Ruggero."]) {
      const d = doc();
      d.units[1].sequence[0].holds[0].afterWord = afterWord;
      const { problems } = layoutUnit(d, "epoca", timings());
      assert.deepEqual(problems.map((p) => [p.code, p.path]), [["bad-hold", "$.units[1].sequence[0].holds[0].afterWord"]], afterWord);
    }
  });

  it("throws for a unit that does not exist", () => {
    assert.throws(() => layoutUnit(doc(), "genesi", timings()), RangeError);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd studio/contracts && node --test test/narration-takes.test.mjs 2>&1 | grep -E "does not provide an export|^# fail"`
Expected: `SyntaxError: The requested module '../src/narration-takes.mjs' does not provide an export named 'layoutUnit'`.

- [ ] **Step 3: Implement the layout**

In `studio/contracts/src/narration-takes.mjs`, below `import { jsonPath } from "./edit-timeline.mjs";` add:

```js
import { normalizeWord } from "./cues.mjs";
```

and append to the end of the file:

```js
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
  return { at: (word.end + timing.words[i + 1].start) / 2 };
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
      else splits.push({ at: split.at, seconds: hold.seconds });
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
```

In `studio/contracts/src/narration-takes.d.mts`, below the line `// The document types are generated from the schema into bindings/ts/narration-takes.ts.` add a blank line and:

```ts
import type { NarrationTakes } from "../bindings/ts/narration-takes.ts";
import type { WordTiming } from "../bindings/ts/word-timing.ts";
import type { CueTiming } from "./cues.mjs";
```

and append to the end of the file:

```ts
/** One stretch of a take's audio, placed in the unit. Seconds. */
export interface LayoutPiece {
  take: string;
  /** Where the piece starts, from the start of the unit. */
  at: number;
  /** Where in the take's audio the piece starts. */
  from: number;
  duration: number;
}

export interface UnitLayout {
  durationSeconds: number;
  pieces: LayoutPiece[];
  /** The unit's words and lines in unit time: what cues resolve against. */
  timing: CueTiming;
  /** Present only when every take has energy at one rate. */
  energy?: { rate: number; values: number[] };
}

/**
 * Lay out one unit. `doc` must pass validateNarrationTakes; `timings` maps take id
 * to its valid WordTiming. Throws RangeError for a unit that does not exist.
 */
export declare function layoutUnit(
  doc: NarrationTakes,
  unitId: string,
  timings: Record<string, WordTiming>,
): { layout: UnitLayout } | { problems: NarrationTakesProblem[] };
```

In `studio/contracts/src/cues.d.mts`, replace

```ts
/** One take placed in the episode. `timing` must already pass validateWordTiming. */
export interface CueScope {
  timing: WordTiming;
```

with

```ts
/**
 * The words a cue is matched against: a take's WordTiming, or a narration
 * unit's layout timing (several takes as one sequence of words).
 */
export interface CueTiming {
  take: { id: string };
  words: Pick<WordTiming["words"][number], "text" | "start" | "end">[];
  lines?: Pick<NonNullable<WordTiming["lines"]>[number], "firstWord" | "lastWord">[];
}

/** One take or unit placed in the episode. A WordTiming must already pass validateWordTiming. */
export interface CueScope {
  timing: CueTiming;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd studio/contracts && node --test test/narration-takes.test.mjs 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 14`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add studio/contracts/src/narration-takes.mjs studio/contracts/src/narration-takes.d.mts \
  studio/contracts/src/cues.d.mts studio/contracts/test/narration-takes.test.mjs
git commit -m "feat(contracts): lay a narration unit out into pieces and unit-time words (avg-7zp.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Qwen mapping

**Files:**
- Modify: `studio/contracts/src/narration-takes.mjs`, `studio/contracts/src/narration-takes.d.mts` (append)
- Modify: `studio/contracts/test/narration-takes.test.mjs` (imports, append the mapping suite)

**Interfaces:**
- Consumes: `layoutUnit`, `validateNarrationTakes`; `fixtures/narration/valid.json` (canonical manifest: one entry `scene-1.turn-1`, duration 1, attempt `11111111-1111-4111-8111-111111111111`; segment `displayText` "Hello world.", role `narrator`, language `en-US`); the agent's lighter manifest shape (`studio/agent/src/narration-manifest.ts`: cursor starts at `leadInSilenceSeconds`, then `+= durationSeconds + pauseAfterMs / 1000`).
- Produces: `takesFromNarrationManifest(manifest, { segments }) → { takes, leadInSeconds }`, `QWEN_PROVIDER`.

- [ ] **Step 1: Write the failing tests**

In `studio/contracts/test/narration-takes.test.mjs`, replace

```js
import { layoutUnit, validateNarrationTakes } from "../src/narration-takes.mjs";
```

with

```js
import {
  QWEN_PROVIDER,
  layoutUnit,
  takesFromNarrationManifest,
  validateNarrationTakes,
} from "../src/narration-takes.mjs";
```

and append:

```js
describe("takesFromNarrationManifest", () => {
  const wav = (name, durationSeconds, hex) => ({
    path: `artifacts/narration/${name}.wav`, contentHash: `sha256:${hex.repeat(64)}`, sizeBytes: 1000,
    durationSeconds, sampleRate: 24000, channels: 1, sampleWidthBytes: 2,
  });
  // The lighter shape studio/agent/src/narration-manifest.ts writes.
  const agentManifest = {
    schemaVersion: "0.1.0",
    leadInSilenceSeconds: 0.5,
    entries: [
      { segmentId: "s1", wav: wav("s1", 1.5, "1"), pauseAfterMs: 250, acceptedAttemptId: "a1" },
      { segmentId: "s2", wav: wav("s2", 2.25, "2"), pauseAfterMs: 400 },
      { segmentId: "s3", wav: wav("s3", 0.75, "3"), pauseAfterMs: 0 },
    ],
    captions: [
      { segmentId: "s1", index: 1, startSeconds: 0.5, endSeconds: 2, text: "Uno." },
      { segmentId: "s2", index: 2, startSeconds: 2.25, endSeconds: 4.5, text: "Due." },
      { segmentId: "s3", index: 3, startSeconds: 4.9, endSeconds: 5.65, text: "Tre." },
    ],
  };
  const timingFor = (take) => ({
    apiVersion: "studio.video/v1alpha1", kind: "WordTiming", take: { id: take.id }, audio: take.audio, text: take.text,
    language: "it", alignment: { provider: "whisper-cpp", method: "asr", createdAt: "2026-10-05T00:00:00Z" },
    words: [{ text: take.text, start: 0.1, end: take.audio.durationSeconds - 0.1 }],
  });

  it("maps the canonical manifest fixture, text from its segment", () => {
    const fixture = read("fixtures/narration/valid.json");
    const { takes, leadInSeconds } = takesFromNarrationManifest(fixture.manifest, { segments: [fixture.segment] });
    assert.equal(leadInSeconds, 0);
    assert.deepEqual(validateNarrationTakes(takes), []);
    assert.deepEqual(takes.takes[0], {
      id: "scene-1.turn-1",
      audio: { path: "artifacts/narration/scene-1.wav", hash: fixture.manifest.entries[0].wav.contentHash, durationSeconds: 1 },
      text: "Hello world.",
      role: "narrator",
      language: "en-US",
      voice: { provider: QWEN_PROVIDER },
      source: { segmentId: "scene-1.turn-1", attemptId: "11111111-1111-4111-8111-111111111111" },
    });
  });

  it("maps the agent's manifest, text from captions, positions unchanged", () => {
    const { takes, leadInSeconds } = takesFromNarrationManifest(agentManifest);
    assert.deepEqual(validateNarrationTakes(takes), []);
    assert.deepEqual(takes.units, [{
      id: "narration",
      sequence: [{ take: "s1" }, { take: "s2", pauseBefore: 0.25 }, { take: "s3", pauseBefore: 0.4 }],
    }]);
    const timings = Object.fromEntries(takes.takes.map((t) => [t.id, timingFor(t)]));
    const { layout } = layoutUnit(takes, "narration", timings);
    // The agent's cursor: lead-in, then duration + pause per segment.
    let cursor = agentManifest.leadInSilenceSeconds;
    const expected = agentManifest.entries.map((e) => {
      const at = Number(cursor.toFixed(6));
      cursor += e.wav.durationSeconds + e.pauseAfterMs / 1000;
      return at;
    });
    assert.deepEqual(layout.pieces.map((p) => Number((leadInSeconds + p.at).toFixed(6))), expected);
  });

  it("refuses to map a segment it has no text for", () => {
    const bare = { ...agentManifest, captions: agentManifest.captions.slice(1) };
    assert.throws(() => takesFromNarrationManifest(bare), /no text for segments: s1/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd studio/contracts && node --test test/narration-takes.test.mjs 2>&1 | grep -E "does not provide an export|^# fail"`
Expected: `… does not provide an export named 'QWEN_PROVIDER'`.

- [ ] **Step 3: Implement the mapping**

Append to `studio/contracts/src/narration-takes.mjs`:

```js
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
    i === 0 ? { take: entry.segmentId } : { take: entry.segmentId, pauseBefore: manifest.entries[i - 1].pauseAfterMs / 1000 },
  );
  return {
    takes: { apiVersion: "studio.video/v1alpha1", kind: "NarrationTakes", takes, units: [{ id: "narration", sequence }] },
    leadInSeconds: manifest.leadInSilenceSeconds ?? 0,
  };
}
```

Append to `studio/contracts/src/narration-takes.d.mts`:

```ts
export declare const QWEN_PROVIDER: "qwen3-tts-local";

/**
 * Map a Qwen narration manifest into takes and one unit, "narration".
 * Throws when a segment has no text in `segments` or in the manifest's captions.
 */
export declare function takesFromNarrationManifest(
  manifest: unknown,
  options?: { segments?: unknown[] },
): { takes: NarrationTakes; leadInSeconds: number };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd studio/contracts && node --test test/narration-takes.test.mjs 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 17`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add studio/contracts/src/narration-takes.mjs studio/contracts/src/narration-takes.d.mts studio/contracts/test/narration-takes.test.mjs
git commit -m "feat(contracts): map the Qwen narration manifest into takes, positions unchanged (avg-7zp.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `check:schemas`, version, docs

**Files:**
- Modify: `studio/contracts/package.json`, `bun.lock`, `studio/contracts/README.md`, `studio/contracts/docs/contract-catalog.md`

**Interfaces:**
- Consumes: `scripts/check-narration-takes-fixtures.mjs` (Task 1).
- Produces: `check:schemas` covers narration takes; contracts 0.5.0.

- [ ] **Step 1: Wire the check and bump the version**

In `studio/contracts/package.json`: `"version": "0.5.0"`; append ` && node scripts/check-narration-takes-fixtures.mjs` to the end of the `check:schemas` string. In `bun.lock`, under `"studio/contracts": {`, change `"version": "0.4.0"` to `"version": "0.5.0"`. Verify: `bun install --frozen-lockfile`.
Expected: `no changes`.

- [ ] **Step 2: Docs**

In `studio/contracts/README.md`, after the `cue.schema.json` row of the schema families table, add:

```markdown
| `narration-takes.schema.json` | Every accepted voice take of an episode, from any tool (text as written, `spokenText` exactly as the tool received it, voice provenance, its word timing), and what each unit plays: takes in order with pauses and declared scene pauses; laid out and mapped from the Qwen narration manifest by `src/narration-takes.mjs` |
```

In `studio/contracts/docs/contract-catalog.md`, after the `cue` row of the families table, add:

```markdown
| `narration-takes` | Narration Takes: provider-neutral take registry (text, spoken text as sent, voice provenance, word timing ref, narration-manifest source) and unit sequences with pauses and scene pauses; unit layout; Qwen manifest mapping | TTS provider adapters, Qwen worker via mapping | series compilers, cue resolver, composer | `avg-7zp.4` |
```

- [ ] **Step 3: Run every check**

Run: `cd studio/contracts && npm run check`
Expected: `check:schemas` includes `1 valid and 7 invalid narration-takes fixtures passed`; bindings up to date; `node --test` 0 failures.

Run: `npm run check` from the repository root.
Expected: passes (14 modules, 0 failed).

- [ ] **Step 4: Commit**

```bash
git add studio/contracts/package.json bun.lock studio/contracts/README.md studio/contracts/docs/contract-catalog.md
git commit -m "chore(contracts): check:schemas covers narration takes; contracts 0.5.0 (avg-7zp.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

