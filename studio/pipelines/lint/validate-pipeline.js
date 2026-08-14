#!/usr/bin/env node

/**
 * validate-pipeline.js — Lint pipeline manifest YAML files against conventions.
 *
 * Usage:
 *   node lint/validate-pipeline.js <file.yaml>...
 *
 * Exit codes:
 *   0 — all files pass
 *   1 — one or more files have lint errors
 *   2 — usage error (missing file, unreadable, parse failure)
 *
 * Two-pass validation:
 *   1. Contracts JSON Schema (ADR-0024) — structure, types, capabilities
 *   2. Bespoke semantic checks not expressible in JSON Schema:
 *      - Stage ID pattern (AP-003) — schema only requires minLength
 *      - Capability vocabulary — schema doesn't validate against canonical set
 *      - Content-type conditional language (AP-006)
 *      - Duplicate contract producers (AP-005)
 *      - Orphan / unresolvable prior-stage sources
 *      - Circular dependencies (AP-015)
 *      - Invalid depends_on references
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

// ── Schema loading ──────────────────────────────────────────────────────────

const SCHEMA_PATH = resolve(__dirname, '../../video-workspace-contracts/schemas/v1alpha1/pipeline-manifest.schema.json');
const RAW_SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(RAW_SCHEMA);
const validateSchema = ajv.getSchema(`${RAW_SCHEMA.$id}#/$defs/PipelineManifest`);

// ── Canonical capability vocabulary ─────────────────────────────────────────

let CANONICAL_CAPABILITIES;
try {
  const vocabPath = resolve(__dirname, '../../video-workspace-contracts/src/vocabulary.mjs');
  const vocab = await import(vocabPath);
  CANONICAL_CAPABILITIES = new Set(vocab.CAPABILITIES);
} catch {
  CANONICAL_CAPABILITIES = new Set([
    'image.generate', 'image.edit', 'speech.synthesize',
    'graphics.render', 'terminal.record', 'video.compose', 'media.probe',
  ]);
}

// ── Rule helpers ────────────────────────────────────────────────────────────

function error(code, message, file, extra = null) {
  return { file, code, message, extra, severity: 'error' };
}

function warning(code, message, file, extra = null) {
  return { file, code, message, extra, severity: 'warning' };
}

// ── Constants ───────────────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CONTENT_CONDITIONAL_PATTERNS = [
  /\bif\s+(it\s+is|the\s+input|content\s+type)\b/i,
  /\b(branch|branching)\s+(on|by)\s+content/i,
  /\bconditional\s+(logic|branch)/i,
  /\bswitch\s+(on|by)\s+(content|input\s+type)/i,
];

// ── Pass 1: schema validation ───────────────────────────────────────────────

function validatePass1(filePath) {
  const file = resolve(filePath);
  let raw;
  try { raw = readFileSync(file, 'utf-8'); }
  catch (e) { return [error('file-read', `Cannot read file: ${e.message}`, file)]; }

  let doc;
  try {
    doc = yaml.load(raw);
    if (doc === null || doc === undefined) {
      return [error('yaml-empty', 'YAML document is empty or null', file)];
    }
  } catch (e) {
    return [error('yaml-parse', `YAML parse error: ${e.message}`, file)];
  }

  const valid = validateSchema(doc);
  const diags = [];

  if (!valid && validateSchema.errors) {
    for (const e of validateSchema.errors) {
      const path = e.instancePath || '(root)';
      diags.push(error('schema-violation',
        `${path}: ${e.message}`, file, { schemaPath: e.schemaPath }));
    }
  }

  return diags;
}

// ── Pass 2: bespoke semantic checks ─────────────────────────────────────────

function extractPipeline(filePath) {
  const file = resolve(filePath);
  let raw;
  try { raw = readFileSync(file, 'utf-8'); }
  catch (_) { return null; }
  try { return yaml.load(raw); }
  catch (_) { return null; }
}

function validatePass2(filePath) {
  const doc = extractPipeline(filePath);
  if (!doc) return [];
  const pipeline = doc.pipeline;
  if (!pipeline || !Array.isArray(pipeline.stages)) return [];
  const stages = pipeline.stages;
  const file = resolve(filePath);

  let diags = [];
  diags = diags.concat(checkStageIds(stages, file));
  diags = diags.concat(checkCapabilityVocabulary(pipeline, stages, file));
  diags = diags.concat(checkContentConditionals(pipeline, stages, file));
  diags = diags.concat(checkDuplicateProducers(stages, file));
  diags = diags.concat(checkOrphanContracts(stages, file));
  diags = diags.concat(checkCircularDeps(stages, file));
  diags = diags.concat(checkDependsOnValidity(stages, pipeline, file));
  return diags;
}

// ── Bespoke check functions ─────────────────────────────────────────────────

function checkStageIds(stages, file) {
  const diags = [];
  const seenIds = new Set();
  for (const stage of stages) {
    if (!stage.id || typeof stage.id !== 'string') {
      diags.push(error('missing-stage-id', 'Each stage must have a string "id"', file, { stage }));
      continue;
    }
    if (!ID_PATTERN.test(stage.id)) {
      if (/[A-Z]/.test(stage.id)) {
        diags.push(error('unstable-stage-id',
          `Stage ID "${stage.id}" contains uppercase characters; use lowercase-hyphen format (AP-003)`, file));
      } else if (/_/.test(stage.id)) {
        diags.push(error('unstable-stage-id',
          `Stage ID "${stage.id}" uses underscores; use hyphens instead (AP-003)`, file));
      } else {
        diags.push(error('unstable-stage-id',
          `Stage ID "${stage.id}" does not match lowercase-hyphen convention (AP-003)`, file));
      }
    }
    if (seenIds.has(stage.id)) {
      diags.push(error('duplicate-stage-id', `Duplicate stage id "${stage.id}"`, file));
    }
    seenIds.add(stage.id);
  }
  return diags;
}

function checkCapabilityVocabulary(pipeline, stages, file) {
  const diags = [];
  if (Array.isArray(pipeline.capabilities)) {
    for (const cap of pipeline.capabilities) {
      if (cap.id && !CANONICAL_CAPABILITIES.has(cap.id)) {
        diags.push(error('unknown-capability',
          `Pipeline capability "${cap.id}" is not in the canonical vocabulary: ${[...CANONICAL_CAPABILITIES].join(', ')}`, file));
      }
    }
  }
  for (const stage of stages) {
    if (stage.capability && !CANONICAL_CAPABILITIES.has(stage.capability)) {
      diags.push(error('unknown-capability',
        `Stage "${stage.id}" capability "${stage.capability}" is not in the canonical vocabulary: ${[...CANONICAL_CAPABILITIES].join(', ')}`, file));
    }
  }
  return diags;
}

function checkContentConditionals(pipeline, stages, file) {
  const diags = [];
  const textToCheck = [pipeline.description || ''];
  for (const stage of stages) textToCheck.push(stage.description || '');
  for (const text of textToCheck) {
    for (const pattern of CONTENT_CONDITIONAL_PATTERNS) {
      if (pattern.test(text)) {
        diags.push(error('content-conditional',
          'Pipeline/description contains content-type branching language (AP-006)', file,
          { match: text.slice(0, 120) }));
        break;
      }
    }
  }
  for (const stage of stages) {
    if (Array.isArray(stage.inputs)) {
      for (const input of stage.inputs) {
        if (input.contract && /content.type/i.test(input.contract)) {
          diags.push(error('content-conditional',
            `Stage "${stage.id}" consumes content-type-indicator contract — content-type branching (AP-006)`, file));
        }
      }
    }
  }
  return diags;
}

function checkDuplicateProducers(stages, file) {
  const diags = [];
  const producers = new Map();
  for (const stage of stages) {
    if (Array.isArray(stage.outputs)) {
      for (const output of stage.outputs) {
        const cid = output.contract;
        if (cid && producers.has(cid)) {
          diags.push(error('duplicate-contract-producer',
            `Contract "${cid}" is produced by both "${producers.get(cid)}" and "${stage.id}" (AP-005)`, file));
        } else if (cid) {
          producers.set(cid, stage.id);
        }
      }
    }
  }
  return diags;
}

function checkOrphanContracts(stages, file) {
  const diags = [];
  for (const stage of stages) {
    if (Array.isArray(stage.inputs)) {
      for (const i of stage.inputs) {
        if (i.contract && i.source && i.source.startsWith('prior-stage.')) {
          const sourceStage = i.source.slice('prior-stage.'.length);
          if (!stages.some(s => s.id === sourceStage)) {
            diags.push(error('unresolvable-source',
              `Stage "${stage.id}" input "${i.contract}" references nonexistent prior stage "${sourceStage}"`, file));
          }
        }
      }
    }
  }
  return diags;
}

function checkCircularDeps(stages, file) {
  const diags = [];
  const adj = new Map();
  for (const stage of stages) adj.set(stage.id, new Set(stage.depends_on || []));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const stage of stages) color.set(stage.id, WHITE);

  function dfs(node, path) {
    color.set(node, GRAY);
    const neighbors = adj.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) continue;
      if (color.get(neighbor) === GRAY) {
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart).concat(neighbor);
        diags.push(error('circular-dependency',
          `Circular stage dependency: ${cycle.join(' \u2192 ')} (AP-015)`, file));
        return;
      }
      if (color.get(neighbor) === WHITE) dfs(neighbor, [...path, neighbor]);
    }
    color.set(node, BLACK);
  }

  for (const stage of stages) {
    if (color.get(stage.id) === WHITE) {
      dfs(stage.id, [stage.id]);
      if (diags.length > 0) break;
    }
  }
  return diags;
}

function checkDependsOnValidity(stages, pipeline, file) {
  const diags = [];
  // Extended pipelines may reference parent stages — skip this check
  if (pipeline.extends) return diags;
  const stageIds = new Set(stages.map(s => s.id));
  for (const stage of stages) {
    if (Array.isArray(stage.depends_on)) {
      for (const dep of stage.depends_on) {
        if (!stageIds.has(dep)) {
          diags.push(error('invalid-dependency',
            `Stage "${stage.id}" depends on "${dep}" which is not defined in this pipeline`, file));
        }
      }
    }
  }
  return diags;
}

// ── Main ────────────────────────────────────────────────────────────────────

function lintPipeline(filePath) {
  const pass1 = validatePass1(filePath);
  const pass2 = validatePass2(filePath);
  return [...pass1, ...pass2];
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node lint/validate-pipeline.js <file.yaml>...');
    process.exit(2);
  }

  let allDiags = [];
  for (const filePath of args) {
    const diags = lintPipeline(filePath);
    allDiags = allDiags.concat(diags);
  }

  if (allDiags.length === 0) {
    console.log('\u2713 All pipeline manifests pass validation.');
    process.exit(0);
  }

  let errors = 0;
  let warnings = 0;
  for (const d of allDiags) {
    const prefix = d.severity === 'error' ? 'ERROR' : 'WARNING';
    if (d.severity === 'error') errors++;
    else warnings++;
    console.error(`${prefix} [${d.code}] ${d.file}`);
    console.error(`  ${d.message}`);
    if (d.extra) console.error(`  context: ${JSON.stringify(d.extra)}`);
    console.error('');
  }
  console.error(`${errors} error(s), ${warnings} warning(s)`);
  process.exit(errors > 0 ? 1 : 0);
}

main();
