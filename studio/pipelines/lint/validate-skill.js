#!/usr/bin/env node

/**
 * validate-skill.js — Lint skill SKILL.md files against frontmatter conventions.
 *
 * Usage:
 *   node lint/validate-skill.js <SKILL.md>...
 *
 * Exit codes:
 *   0 — all files pass
 *   1 — one or more files have lint errors
 *   2 — usage error (missing file, unreadable, parse failure)
 *
 * Checks:
 *   - Valid YAML frontmatter between --- delimiters
 *   - All required fields: skill.id, skill.pipeline, skill.stage, skill.version, skill.kind
 *   - progressive_disclosure section with at least summary
 *   - inputs array is non-empty
 *   - skill.kind is one of: producer, reviewer, mixed
 *   - Reviewer skills have review.checklist
 *   - No orchestration fields: run_after, retry_count, timeout_seconds, fallback_skill
 *   - No gate fields: gates, autopilot
 *   - No budget fields at top level
 *   - Semver on all version fields
 *   - Skill ID follows lowercase-hyphen convention
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
const VALID_KINDS = new Set(['producer', 'reviewer', 'mixed']);
const ORCHESTRATION_FIELDS = ['run_after', 'retry_count', 'timeout_seconds', 'fallback_skill'];
const GATE_FIELDS = ['gates', 'autopilot'];

function error(code, message, file, extra = null) {
  return { file, code, message, extra, severity: 'error' };
}

function warning(code, message, file, extra = null) {
  return { file, code, message, extra, severity: 'warning' };
}

// ---------------------------------------------------------------------------
// YAML extraction
// ---------------------------------------------------------------------------

function extractFrontmatter(raw, file) {
  const lines = raw.split('\n');
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return [[error('no-frontmatter', 'File does not start with --- frontmatter delimiter', file)], null];
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return [[error('unclosed-frontmatter', 'Frontmatter is not closed with ---', file)], null];
  }

  const yamlStr = lines.slice(1, endIndex).join('\n');
  try {
    const doc = yaml.load(yamlStr);
    if (doc === null || doc === undefined) {
      return [[error('empty-frontmatter', 'Frontmatter is empty', file)], null];
    }
    return [[], doc];
  } catch (e) {
    return [[error('yaml-parse', `Frontmatter YAML parse error: ${e.message}`, file)], null];
  }
}

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

function checkRequiredSkillFields(doc, file) {
  const diags = [];
  if (!doc.skill || typeof doc.skill !== 'object') {
    diags.push(error('missing-skill-section', '"skill" section is required in frontmatter (AP-007)', file));
    return diags;
  }

  const s = doc.skill;
  const required = ['id', 'pipeline', 'stage', 'version', 'kind'];
  for (const field of required) {
    if (s[field] === undefined || s[field] === null || s[field] === '') {
      diags.push(error('missing-skill-field',
        `skill.${field} is required (AP-007)`, file));
    }
  }

  if (s.id && !ID_PATTERN.test(s.id)) {
    diags.push(error('invalid-skill-id',
      `skill.id "${s.id}" must be lowercase-hyphen-separated`, file));
  }

  if (s.pipeline && !ID_PATTERN.test(s.pipeline)) {
    diags.push(error('invalid-pipeline-ref',
      `skill.pipeline "${s.pipeline}" must be lowercase-hyphen-separated`, file));
  }

  if (s.stage && !ID_PATTERN.test(s.stage)) {
    diags.push(error('invalid-stage-ref',
      `skill.stage "${s.stage}" must be lowercase-hyphen-separated`, file));
  }

  if (s.version && !SEMVER_PATTERN.test(String(s.version))) {
    diags.push(error('requires-semver',
      `skill.version "${s.version}" is not valid semver (AP-011)`, file));
  }

  if (s.kind && !VALID_KINDS.has(s.kind)) {
    diags.push(error('invalid-kind',
      `skill.kind "${s.kind}" must be one of: ${[...VALID_KINDS].join(', ')} (AP-009)`, file));
  }

  return diags;
}

function checkProgressiveDisclosure(doc, file) {
  const diags = [];
  if (!doc.progressive_disclosure || typeof doc.progressive_disclosure !== 'object') {
    diags.push(error('missing-progressive-disclosure',
      '"progressive_disclosure" section is required with at least a summary (AP-002)', file));
    return diags;
  }

  const pd = doc.progressive_disclosure;
  if (!pd.summary || typeof pd.summary !== 'string' || pd.summary.trim().length === 0) {
    diags.push(error('missing-progressive-summary',
      'progressive_disclosure.summary is required (AP-002)', file));
  }

  return diags;
}

function checkInputs(doc, file) {
  const diags = [];
  if (!doc.inputs || !Array.isArray(doc.inputs) || doc.inputs.length === 0) {
    diags.push(error('missing-inputs',
      '"inputs" must be a non-empty array (AP-007)', file));
    return diags;
  }

  for (const input of doc.inputs) {
    if (!input.contract) {
      diags.push(error('missing-input-contract', 'Each input must have a "contract" field', file));
    }
    if (input.version && !SEMVER_PATTERN.test(String(input.version))) {
      diags.push(error('requires-semver',
        `Input "${input.contract || 'unknown'}" version "${input.version}" is not valid semver (AP-011)`, file));
    }
  }

  return diags;
}

function checkOutputs(doc, file) {
  const diags = [];
  const kind = (doc.skill && doc.skill.kind) || '';
  const isReviewer = kind === 'reviewer' || kind === 'mixed';

  // Producers and mixed must have outputs; pure reviewers use review.produces
  if (kind === 'producer' || kind === 'mixed') {
    if (!doc.outputs || !Array.isArray(doc.outputs) || doc.outputs.length === 0) {
      const hasReviewProduces = doc.review && Array.isArray(doc.review.produces) && doc.review.produces.length > 0;
      if (!hasReviewProduces || kind === 'producer') {
        diags.push(error('missing-outputs',
          `Skill with kind "${kind}" must have "outputs" or review.produces`, file));
      }
    }
    if (Array.isArray(doc.outputs)) {
      for (const output of doc.outputs) {
        if (output.version && !SEMVER_PATTERN.test(String(output.version))) {
          diags.push(error('requires-semver',
            `Output "${output.contract || 'unknown'}" version "${output.version}" is not valid semver (AP-011)`, file));
        }
      }
    }
  }

  return diags;
}

function checkReviewer(doc, file) {
  const diags = [];
  const kind = (doc.skill && doc.skill.kind) || '';

  if (kind === 'reviewer' || kind === 'mixed') {
    if (!doc.review || typeof doc.review !== 'object') {
      diags.push(error('reviewer-requires-checklist',
        'Skills with kind "reviewer" or "mixed" must have a "review" section with a checklist (AP-008)', file));
    } else {
      if (!Array.isArray(doc.review.checklist) || doc.review.checklist.length === 0) {
        diags.push(error('reviewer-requires-checklist',
          'review.checklist must be a non-empty array (AP-008)', file));
      } else {
        for (const item of doc.review.checklist) {
          if (!item.id) {
            diags.push(error('missing-checklist-id', 'Each checklist item must have an "id"', file));
          }
          if (!item.severity || !['error', 'warning', 'info'].includes(item.severity)) {
            diags.push(error('invalid-checklist-severity',
              `Checklist item "${item.id || 'unknown'}" severity must be error, warning, or info`, file));
          }
        }
      }
      if (!doc.review.format || !['structured', 'freeform', 'pass-fail'].includes(doc.review.format)) {
        diags.push(error('invalid-review-format',
          'review.format must be structured, freeform, or pass-fail', file));
      }
    }
  }

  return diags;
}

function checkNoOrchestrationFields(doc, file) {
  const diags = [];
  for (const field of ORCHESTRATION_FIELDS) {
    if (doc[field] !== undefined) {
      diags.push(error('orchestration-in-skill',
        `"${field}" is an orchestration field and belongs in the pipeline manifest, not in a skill (AP-001)`, file));
    }
  }
  return diags;
}

function checkNoGateFields(doc, file) {
  const diags = [];
  for (const field of GATE_FIELDS) {
    if (doc[field] !== undefined) {
      diags.push(error('gate-in-skill',
        `"${field}" is a gate field and belongs in the pipeline manifest, not in a skill (AP-013)`, file));
    }
  }
  return diags;
}

function checkNoBudgetInSkill(doc, file) {
  const diags = [];
  if (doc.budget !== undefined) {
    diags.push(error('budget-in-skill',
      '"budget" belongs in the pipeline manifest stages[].gates.budget, not in a skill (AP-010)', file));
  }
  return diags;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function lintSkill(filePath) {
  const file = resolve(filePath);
  let raw;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch (e) {
    return [error('file-read', `Cannot read file: ${e.message}`, file)];
  }

  const [fmDiags, doc] = extractFrontmatter(raw, file);
  if (fmDiags && fmDiags.length > 0) return fmDiags;
  if (!doc) return [];

  let diags = [];
  diags = diags.concat(checkRequiredSkillFields(doc, file));
  diags = diags.concat(checkProgressiveDisclosure(doc, file));
  diags = diags.concat(checkInputs(doc, file));
  diags = diags.concat(checkOutputs(doc, file));
  diags = diags.concat(checkReviewer(doc, file));
  diags = diags.concat(checkNoOrchestrationFields(doc, file));
  diags = diags.concat(checkNoGateFields(doc, file));
  diags = diags.concat(checkNoBudgetInSkill(doc, file));

  return diags;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node lint/validate-skill.js <SKILL.md>...');
    process.exit(2);
  }

  let allDiags = [];
  for (const filePath of args) {
    const diags = lintSkill(filePath);
    allDiags = allDiags.concat(diags);
  }

  if (allDiags.length === 0) {
    console.log('✓ All skill files pass validation.');
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
