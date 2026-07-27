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
 * Checks:
 *   - Valid YAML syntax
 *   - pipeline.id follows lowercase-hyphen convention
 *   - pipeline.version is valid semver
 *   - stages[] is non-empty
 *   - Each stage has: id, name, capability, inputs, outputs, gates, depends_on
 *   - Stage IDs follow lowercase-hyphen convention
 *   - No duplicate contract producers across stages (AP-005)
 *   - No orphan contracts (AP-004)
 *   - No content-type conditional language in descriptions (AP-006)
 *   - No circular stage dependencies (AP-015)
 *   - No stage IDs with underscores or uppercase (AP-003)
 *   - Semver on all version fields
 *   - Valid gate review enum values
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
const VALID_REVIEW_VALUES = new Set(['none', 'human', 'skill', 'human-or-skill']);
const CONTENT_CONDITIONAL_PATTERNS = [
  /\bif\s+(it\s+is|the\s+input|content\s+type)\b/i,
  /\b(branch|branching)\s+(on|by)\s+content/i,
  /\bconditional\s+(logic|branch)/i,
  /\bswitch\s+(on|by)\s+(content|input\s+type)/i,
];

function error(code, message, file, extra = null) {
  return { file, code, message, extra, severity: 'error' };
}

function warning(code, message, file, extra = null) {
  return { file, code, message, extra, severity: 'warning' };
}

// ---------------------------------------------------------------------------
// Check functions — each returns an array of diagnostics
// ---------------------------------------------------------------------------

function checkYamlSyntax(raw, file) {
  try {
    const doc = yaml.load(raw);
    if (doc === null || doc === undefined) {
      return [error('yaml-empty', 'YAML document is empty or null', file)];
    }
    return [null, doc]; // first element is null (no diag), second is parsed doc
  } catch (e) {
    return [[error('yaml-parse', `YAML parse error: ${e.message}`, file)], null];
  }
}

function checkPipelineStructure(doc, file) {
  const diags = [];
  if (!doc || typeof doc !== 'object') {
    return [diags, null];
  }
  if (!doc.pipeline) {
    diags.push(error('missing-pipeline-key', 'Top-level "pipeline" key is required', file));
    return [diags, null];
  }
  const p = doc.pipeline;
  if (typeof p !== 'object') {
    diags.push(error('invalid-pipeline-type', '"pipeline" must be an object', file));
    return [diags, null];
  }
  return [diags, p];
}

function checkPipelineId(p, file) {
  const diags = [];
  if (!p.id || typeof p.id !== 'string') {
    diags.push(error('missing-pipeline-id', 'pipeline.id is required and must be a string', file));
  } else if (!ID_PATTERN.test(p.id)) {
    diags.push(error('invalid-pipeline-id',
      `pipeline.id "${p.id}" must be lowercase-hyphen-separated (e.g., "narrated-illustrated-video")`, file));
  }
  return diags;
}

function checkPipelineVersion(p, file) {
  const diags = [];
  if (!p.version || typeof p.version !== 'string') {
    diags.push(error('missing-pipeline-version', 'pipeline.version is required and must be a string', file));
  } else if (!SEMVER_PATTERN.test(p.version)) {
    diags.push(error('invalid-pipeline-version',
      `pipeline.version "${p.version}" is not valid semver`, file));
  }
  return diags;
}

function checkStages(p, file) {
  const diags = [];
  if (!Array.isArray(p.stages)) {
    diags.push(error('stages-required', 'pipeline.stages must be a non-empty array', file));
    return [diags, []];
  }
  if (p.stages.length === 0) {
    diags.push(error('stages-required', 'pipeline.stages must have at least one stage (AP-014)', file));
  }
  return [diags, p.stages];
}

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
      diags.push(error('duplicate-stage-id',
        `Duplicate stage id "${stage.id}"`, file));
    }
    seenIds.add(stage.id);
  }
  return diags;
}

function checkRequiredStageFields(stages, file) {
  const diags = [];
  const required = ['name', 'capability', 'inputs', 'outputs', 'gates', 'depends_on'];
  for (const stage of stages) {
    for (const field of required) {
      if (stage[field] === undefined || stage[field] === null) {
        diags.push(error('missing-stage-field',
          `Stage "${stage.id || 'unknown'}" is missing required field "${field}"`, file));
      }
    }
    if (stage.gates && typeof stage.gates === 'object') {
      if (stage.gates.review !== undefined && !VALID_REVIEW_VALUES.has(stage.gates.review)) {
        diags.push(error('invalid-gate-review',
          `Stage "${stage.id}" gate.review "${stage.gates.review}" must be one of: ${[...VALID_REVIEW_VALUES].join(', ')}`, file));
      }
    }
    // Check version fields in inputs/outputs
    for (const ioKey of ['inputs', 'outputs']) {
      if (Array.isArray(stage[ioKey])) {
        for (const item of stage[ioKey]) {
          if (item.version && !SEMVER_PATTERN.test(String(item.version))) {
            diags.push(error('requires-semver',
              `Stage "${stage.id}" ${ioKey} contract "${item.contract || 'unknown'}" version "${item.version}" is not valid semver (AP-011)`, file));
          }
        }
      }
    }
  }
  return diags;
}

function checkDuplicateProducers(stages, file) {
  const diags = [];
  const producers = new Map(); // contract -> stageId
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
  const produced = new Set();
  const consumed = new Set();
  const consumers = new Map(); // contract -> [stageIds]

  for (const stage of stages) {
    if (Array.isArray(stage.outputs)) {
      for (const o of stage.outputs) {
        if (o.contract) produced.add(o.contract);
      }
    }
    if (Array.isArray(stage.inputs)) {
      for (const i of stage.inputs) {
        if (i.contract) {
          consumed.add(i.contract);
          if (!consumers.has(i.contract)) consumers.set(i.contract, []);
          consumers.get(i.contract).push(stage.id);
        }
      }
    }
  }

  // Upstream and series-local inputs are externally provided — don't flag those
  // Output contracts that no internal stage consumes are valid — they are
  // terminal outputs consumed by the pipeline caller or downstream system.
  // We do NOT flag these as orphan. The real error is inputs without producers.


  // Input contracts from prior-stage that don't have a producer
  for (const stage of stages) {
    if (Array.isArray(stage.inputs)) {
      for (const i of stage.inputs) {
        if (i.contract && i.source && i.source.startsWith('prior-stage.')) {
          const sourceStage = i.source.slice('prior-stage.'.length);
          if (!produced.has(i.contract)) {
            // Check if the referenced stage exists
            const stageExists = stages.some(s => s.id === sourceStage);
            if (!stageExists) {
              diags.push(error('unresolvable-source',
                `Stage "${stage.id}" input "${i.contract}" references nonexistent prior stage "${sourceStage}"`, file));
            }
          }
        }
      }
    }
  }

  return diags;
}

function checkContentConditionals(p, stages, file) {
  const diags = [];
  const textToCheck = [p.description || ''];
  for (const stage of stages) {
    textToCheck.push(stage.description || '');
  }

  for (const text of textToCheck) {
    for (const pattern of CONTENT_CONDITIONAL_PATTERNS) {
      if (pattern.test(text)) {
        diags.push(error('content-conditional',
          'Pipeline description contains content-type conditional language. Use separate pipelines or series overrides (AP-006)', file,
          { match: text.slice(0, 120) }));
        break; // one match per text is enough
      }
    }
    // Also check for content-type-indicator as input
  }

  // Check for content-type-indicator in inputs
  for (const stage of stages) {
    if (Array.isArray(stage.inputs)) {
      for (const input of stage.inputs) {
        if (input.contract && /content.type/i.test(input.contract)) {
          diags.push(error('content-conditional',
            `Stage "${stage.id}" consumes content-type-indicator contract — this suggests content-type branching (AP-006)`, file));
        }
      }
    }
  }

  return diags;
}

function checkCircularDeps(stages, file) {
  const diags = [];
  const adj = new Map();
  for (const stage of stages) {
    adj.set(stage.id, new Set(stage.depends_on || []));
  }

  // DFS-based cycle detection
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const stage of stages) color.set(stage.id, WHITE);

  function dfs(node, path) {
    color.set(node, GRAY);
    const neighbors = adj.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) continue; // depends on stage not in this pipeline — may be upstream
      if (color.get(neighbor) === GRAY) {
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart).concat(neighbor);
        diags.push(error('circular-dependency',
          `Circular stage dependency detected: ${cycle.join(' → ')} (AP-015)`, file));
        return;
      }
      if (color.get(neighbor) === WHITE) {
        dfs(neighbor, [...path, neighbor]);
      }
    }
    color.set(node, BLACK);
  }

  for (const stage of stages) {
    if (color.get(stage.id) === WHITE) {
      dfs(stage.id, [stage.id]);
      if (diags.length > 0) break; // one cycle report is enough
    }
  }

  return diags;
}

function checkDependsOnValidity(stages, file) {
  const diags = [];
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function lintPipeline(filePath) {
  const file = resolve(filePath);
  let raw;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch (e) {
    return [error('file-read', `Cannot read file: ${e.message}`, file)];
  }

  const [yamlDiags, doc] = checkYamlSyntax(raw, file);
  if (yamlDiags && yamlDiags.length > 0) {
    return yamlDiags;
  }
  if (!doc) return [];

  const [structDiags, pipeline] = checkPipelineStructure(doc, file);
  if (structDiags.length > 0 || !pipeline) return structDiags;

  let diags = [];
  diags = diags.concat(checkPipelineId(pipeline, file));
  diags = diags.concat(checkPipelineVersion(pipeline, file));

  const [stageDiags, stages] = checkStages(pipeline, file);
  diags = diags.concat(stageDiags);
  if (stages.length === 0) return diags;

  diags = diags.concat(checkStageIds(stages, file));
  diags = diags.concat(checkRequiredStageFields(stages, file));
  diags = diags.concat(checkDuplicateProducers(stages, file));
  diags = diags.concat(checkOrphanContracts(stages, file));
  diags = diags.concat(checkContentConditionals(pipeline, stages, file));
  diags = diags.concat(checkCircularDeps(stages, file));
  diags = diags.concat(checkDependsOnValidity(stages, file));

  return diags;
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
    console.log('✓ All pipeline manifests pass validation.');
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
    if (d.extra) {
      console.error(`  context: ${JSON.stringify(d.extra)}`);
    }
    console.error('');
  }

  console.error(`${errors} error(s), ${warnings} warning(s)`);
  process.exit(errors > 0 ? 1 : 0);
}

main();
