/**
 * conventions.test.js — Deterministic tests for pipeline and skill conventions.
 *
 * Tests cover:
 *   - Pipeline lint rules (success paths)
 *   - Pipeline lint rules (failure paths — anti-patterns)
 *   - Skill lint rules (success paths)
 *   - Skill lint rules (failure paths — anti-patterns)
 *   - Schema compliance
 *   - Exit code behavior
 *   - Documentation and fixture integrity
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function lintPipeline(fixture) {
  const path = resolve(ROOT, 'fixtures', fixture);
  try {
    const stdout = execSync(`node ${resolve(ROOT, 'lint/validate-pipeline.js')} "${path}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    });
    return { exitCode: 0, stdout: stdout.trim(), stderr: '' };
  } catch (e) {
    return {
      exitCode: e.status,
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim(),
    };
  }
}

function lintSkill(fixture) {
  const path = resolve(ROOT, 'fixtures', fixture);
  try {
    const stdout = execSync(`node ${resolve(ROOT, 'lint/validate-skill.js')} "${path}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    });
    return { exitCode: 0, stdout: stdout.trim(), stderr: '' };
  } catch (e) {
    return {
      exitCode: e.status,
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim(),
    };
  }
}

// ============================================================================
// Pipeline lint tests
// ============================================================================

describe('Pipeline manifest lint — success paths', () => {
  it('valid basic pipeline passes with exit 0', () => {
    const result = lintPipeline('valid/pipeline-basic.yaml');
    assert.equal(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}\n${result.stderr}`);
    assert.ok(result.stdout.includes('pass'), 'Expected success message');
  });

  it('valid pipeline has no errors in stderr', () => {
    const result = lintPipeline('valid/pipeline-basic.yaml');
    assert.equal(result.stderr, '', `Expected empty stderr, got: ${result.stderr}`);
  });
});

describe('Pipeline manifest lint — failure paths', () => {
  it('invalid pipeline fails with exit 1', () => {
    const result = lintPipeline('invalid/pipeline-leaked-orchestration.yaml');
    assert.equal(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);
  });

  it('detects missing stage type — stage-one lacks type field', () => {
    const result = lintPipeline('invalid/stage-missing-type.yaml');
    assert.equal(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);
    assert.ok(
      result.stderr.includes("must have required property 'type'") || result.stderr.includes('missing-stage-type'),
      `Expected type validation error. stderr: ${result.stderr}`
    );
  });

  it('detects editorial with capability — stage-two has both', () => {
    const result = lintPipeline('invalid/stage-missing-type.yaml');
    assert.ok(
      result.stderr.includes('must NOT be valid') || result.stderr.includes('editorial-with-capability'),
      `Expected editorial+capability error. stderr: ${result.stderr}`
    );
  });

  it('detects capability without capability — stage-three missing capability field', () => {
    const result = lintPipeline('invalid/stage-missing-type.yaml');
    assert.ok(
      result.stderr.includes("must have required property 'capability'") || result.stderr.includes('capability-without-capability'),
      `Expected missing capability error. stderr: ${result.stderr}`
    );
  });

  it('detects unknown capability — non-canonical vocabulary', () => {
    const result = lintPipeline('invalid/unknown-capability.yaml');
    assert.equal(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);
    assert.ok(
      result.stderr.includes('unknown-capability'),
      `Expected "unknown-capability" error. stderr: ${result.stderr}`
    );
    assert.ok(
      result.stderr.includes('legacy-llm'),
      `Expected mention of "legacy-llm". stderr: ${result.stderr}`
    );
  });

  it('detects unstable stage ID (underscore) — AP-003', () => {
    const result = lintPipeline('invalid/pipeline-leaked-orchestration.yaml');
    assert.ok(
      result.stderr.includes('unstable-stage-id'),
      `Expected "unstable-stage-id" error. stderr: ${result.stderr}`
    );
    assert.ok(
      result.stderr.includes('stage_3'),
      `Expected mention of "stage_3". stderr: ${result.stderr}`
    );
  });

  it('detects content-type conditional language — AP-006', () => {
    const result = lintPipeline('invalid/pipeline-leaked-orchestration.yaml');
    assert.ok(
      result.stderr.includes('content-conditional'),
      `Expected "content-conditional" error. stderr: ${result.stderr}`
    );
  });

  it('detects duplicate contract producer — AP-005', () => {
    const result = lintPipeline('invalid/pipeline-leaked-orchestration.yaml');
    assert.ok(
      result.stderr.includes('duplicate-contract-producer'),
      `Expected "duplicate-contract-producer" error. stderr: ${result.stderr}`
    );
    assert.ok(
      result.stderr.includes('shared-output'),
      `Expected mention of "shared-output". stderr: ${result.stderr}`
    );
  });

  it('detects unresolvable prior-stage source', () => {
    const result = lintPipeline('invalid/pipeline-leaked-orchestration.yaml');
    assert.ok(
      result.stderr.includes('unresolvable-source'),
      `Expected "unresolvable-source" error. stderr: ${result.stderr}`
    );
  });

  it('detects empty pipeline (no stages) with AP-014', () => {
    const result = lintPipeline('invalid/pipeline-empty-stages.yaml');
    assert.equal(result.exitCode, 1, `Expected exit 1 for empty stages, got ${result.exitCode}`);
    assert.ok(
      result.stderr.includes('must NOT have fewer than 1 items') || result.stderr.includes('stages-required'),
      `Expected empty-stages error. stderr: ${result.stderr}`
    );
  });
});

describe('Pipeline manifest lint — edge cases', () => {
  it('missing file causes error exit', () => {
    const result = lintPipeline('nonexistent.yaml');
    assert.equal(result.exitCode, 1, `Expected exit 1 for missing file, got ${result.exitCode}`);
  });

  it('no arguments causes exit 2', () => {
    try {
      execSync(`node ${resolve(ROOT, 'lint/validate-pipeline.js')}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.equal(e.status, 2, `Expected exit 2 for missing args, got ${e.status}`);
    }
  });
});

// ============================================================================
// Skill lint tests
// ============================================================================

describe('Skill frontmatter lint — success paths', () => {
  it('valid basic skill passes with exit 0', () => {
    const result = lintSkill('valid/skill-basic.yaml');
    assert.equal(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}\n${result.stderr}`);
    assert.ok(result.stdout.includes('pass'), 'Expected success message');
  });

  it('valid skill has no errors in stderr', () => {
    const result = lintSkill('valid/skill-basic.yaml');
    assert.equal(result.stderr, '', `Expected empty stderr, got: ${result.stderr}`);
  });
});

describe('Skill frontmatter lint — failure paths', () => {
  it('invalid skill fails with exit 1', () => {
    const result = lintSkill('invalid/skill-missing-frontmatter.yaml');
    assert.equal(result.exitCode, 1, `Expected exit 1, got ${result.exitCode}`);
  });

  it('detects missing progressive_disclosure — AP-002', () => {
    const result = lintSkill('invalid/skill-missing-frontmatter.yaml');
    assert.ok(
      result.stderr.includes('missing-progressive-disclosure'),
      `Expected "missing-progressive-disclosure" error. stderr: ${result.stderr}`
    );
  });

  it('detects orchestration in skill — AP-001 (run_after)', () => {
    const result = lintSkill('invalid/skill-missing-frontmatter.yaml');
    assert.ok(
      result.stderr.includes('orchestration-in-skill'),
      `Expected "orchestration-in-skill" error. stderr: ${result.stderr}`
    );
    assert.ok(
      result.stderr.includes('run_after'),
      `Expected mention of "run_after". stderr: ${result.stderr}`
    );
  });

  it('detects gate in skill — AP-013 (gates)', () => {
    const result = lintSkill('invalid/skill-missing-frontmatter.yaml');
    assert.ok(
      result.stderr.includes('gate-in-skill'),
      `Expected "gate-in-skill" error. stderr: ${result.stderr}`
    );
  });

  it('detects budget in skill — AP-010', () => {
    const result = lintSkill('invalid/skill-missing-frontmatter.yaml');
    assert.ok(
      result.stderr.includes('budget-in-skill'),
      `Expected "budget-in-skill" error. stderr: ${result.stderr}`
    );
  });

  it('detects missing skill.kind — AP-007', () => {
    const result = lintSkill('invalid/skill-missing-frontmatter.yaml');
    assert.ok(
      result.stderr.includes('missing-skill-field'),
      `Expected "missing-skill-field" error. stderr: ${result.stderr}`
    );
  });

  it('detects missing inputs — AP-007', () => {
    const result = lintSkill('invalid/skill-missing-frontmatter.yaml');
    assert.ok(
      result.stderr.includes('missing-inputs'),
      `Expected "missing-inputs" error. stderr: ${result.stderr}`
    );
  });
});

describe('Skill frontmatter lint — edge cases', () => {
  it('missing file causes error exit', () => {
    const result = lintSkill('nonexistent.md');
    assert.equal(result.exitCode, 1, `Expected exit 1 for missing file, got ${result.exitCode}`);
  });

  it('no arguments causes exit 2', () => {
    try {
      execSync(`node ${resolve(ROOT, 'lint/validate-skill.js')}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.equal(e.status, 2, `Expected exit 2 for missing args, got ${e.status}`);
    }
  });
});

// ============================================================================
// Schema compliance tests
// ============================================================================

describe('Schema compliance', () => {
  // ADR-0024: the pipeline manifest schema is owned by
  // @studio/contracts. This package must NOT carry its own copy —
  // a stale local duplicate previously rejected all three real manifests.
  it('does not define a competing local pipeline manifest schema', () => {
    const stale = resolve(ROOT, 'schemas/pipeline-manifest.schema.yaml');
    assert.ok(
      !existsSync(stale),
      'schemas/pipeline-manifest.schema.yaml must not exist; the canonical ' +
        'schema lives in @studio/contracts (ADR-0024)',
    );
  });

  it('canonical pipeline manifest schema is resolvable and is the one the linter uses', () => {
    const canonical = createRequire(import.meta.url).resolve('@studio/contracts/schemas/v1alpha1/pipeline-manifest.schema.json');
    assert.ok(existsSync(canonical), 'canonical contracts schema should exist');
    const doc = JSON.parse(readFileSync(canonical, 'utf-8'));
    assert.equal(doc.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.ok(doc.$defs?.PipelineStage, 'schema should define PipelineStage');

    const linter = readFileSync(resolve(ROOT, 'lint/validate-pipeline.js'), 'utf-8');
    assert.match(
      linter,
      /@studio\/contracts\/schemas\/v1alpha1\/pipeline-manifest\.schema\.json/,
      'linter must validate against the canonical contracts schema',
    );
  });

  it('skill frontmatter schema file exists and is valid YAML', () => {
    const path = resolve(ROOT, 'schemas/skill-frontmatter.schema.yaml');
    const raw = readFileSync(path, 'utf-8');
    const doc = yaml.load(raw);
    assert.ok(doc, 'Schema should parse as YAML');
    assert.equal(doc.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(doc.title, 'Skill Frontmatter');
  });
});

// ============================================================================
// Documentation existence tests
// ============================================================================

describe('Documentation completeness', () => {
  const docs = [
    'pipeline-conventions/PIPELINE-MANIFEST.md',
    'pipeline-conventions/SKILL-FRONTMATTER.md',
    'pipeline-conventions/STAGE-I-O-CHECKLIST.md',
    'pipeline-conventions/REVIEWER-FORMAT.md',
    'pipeline-conventions/SERIES-OVERRIDES.md',
    'pipeline-conventions/ANTI-PATTERNS.md',
    'pipeline-conventions/README.md',
    'schemas/skill-frontmatter.schema.yaml',
  ];

  for (const doc of docs) {
    it(`${doc} exists`, () => {
      const path = resolve(ROOT, doc);
      assert.ok(existsSync(path), `${doc} should exist at ${path}`);
    });
  }
});

// ============================================================================
// Fixture integrity tests
// ============================================================================

describe('Fixture integrity', () => {
  it('all fixtures are valid YAML files (parseable)', () => {
    const fixtureDirs = ['fixtures/valid', 'fixtures/invalid'];
    for (const dir of fixtureDirs) {
      const fullDir = resolve(ROOT, dir);
      if (!existsSync(fullDir)) continue;
      const files = readdirSync(fullDir);
      for (const file of files) {
        if (file.endsWith('.yaml')) {
          const raw = readFileSync(join(fullDir, file), 'utf-8');
          // Check for frontmatter-style files (start with ---)
          if (raw.startsWith('---')) {
            // Extract and parse YAML between --- delimiters
            const yamlStr = raw.split('---').slice(1, 2).join('---');
            const doc = yaml.load(yamlStr);
            assert.ok(doc !== undefined, `${dir}/${file} frontmatter should parse as YAML`);
          } else {
            const doc = yaml.load(raw);
            assert.ok(doc !== undefined, `${dir}/${file} should parse as YAML`);
          }
        }
      }
    }
  });
});
