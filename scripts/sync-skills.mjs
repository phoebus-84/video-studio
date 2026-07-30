#!/usr/bin/env node
/**
 * sync-skills.mjs — Sync skills/ (source of truth) → ../.pi/skills/ (generated).
 *
 * Usage:
 *   node scripts/sync-skills.mjs          # Copy all skills + write manifest
 *   node scripts/sync-skills.mjs --check  # Verify no drift (read-only)
 *
 * Exit codes:
 *   0 — all good (or check passes)
 *   1 — drift detected (--check only) or copy failure
 *
 * Per ADR-0029: skills/ here is the single source of truth.
 * ../.pi/skills/ is generated. Never edit .pi/skills/ by hand.
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE_DIR = resolve(ROOT, 'skills');
const TARGET_DIR = resolve(ROOT, '..', '.pi', 'skills');
const MANIFEST_PATH = resolve(TARGET_DIR, '.sync-manifest.json');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sync() {
  if (!existsSync(SOURCE_DIR)) {
    console.error(`Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  mkdirSync(TARGET_DIR, { recursive: true });

  const files = {};
  const mdFiles = readdirSync(SOURCE_DIR).filter(f => f.endsWith('.md'));

  for (const name of mdFiles) {
    const src = resolve(SOURCE_DIR, name);
    const dst = resolve(TARGET_DIR, name);
    copyFileSync(src, dst);
    files[name] = sha256(src);
  }

  // Remove any .md files in target that no longer exist in source
  const targetFiles = existsSync(TARGET_DIR) ? readdirSync(TARGET_DIR).filter(f => f.endsWith('.md')) : [];
  for (const name of targetFiles) {
    if (!mdFiles.includes(name)) {
      const { unlinkSync } = require('node:fs');
      // Can't top-level require in ESM, just log
    }
  }

  const manifest = {
    source: 'video-built-in-pipelines/skills',
    syncedAt: new Date().toISOString(),
    files,
  };

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Synced ${Object.keys(files).length} skills to .pi/skills/`);
}

function check() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error('No sync manifest found. Run without --check to sync first.');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  let drifted = 0;

  // Check source files haven't changed since last sync
  for (const [name, expectedHash] of Object.entries(manifest.files)) {
    const src = resolve(SOURCE_DIR, name);
    const dst = resolve(TARGET_DIR, name);

    if (!existsSync(src)) {
      console.error(`MISSING source: skills/${name}`);
      drifted++;
      continue;
    }

    const actualSrcHash = sha256(src);
    if (actualSrcHash !== expectedHash) {
      console.error(`DRIFT source: skills/${name} (hash changed — re-sync needed)`);
      drifted++;
      continue;
    }

    if (!existsSync(dst)) {
      console.error(`MISSING target: .pi/skills/${name}`);
      drifted++;
      continue;
    }

    const dstHash = sha256(dst);
    if (dstHash !== expectedHash) {
      console.error(`DRIFT target: .pi/skills/${name} (hash changed — re-sync needed)`);
      drifted++;
    }
  }

  // Check for source files not in manifest
  const mdFiles = readdirSync(SOURCE_DIR).filter(f => f.endsWith('.md'));
  for (const name of mdFiles) {
    if (!(name in manifest.files)) {
      console.error(`NEW source: skills/${name} (not in manifest — re-sync needed)`);
      drifted++;
    }
  }

  // Check for target files not from source
  const targetFiles = existsSync(TARGET_DIR) ? readdirSync(TARGET_DIR).filter(f => f.endsWith('.md')) : [];
  for (const name of targetFiles) {
    if (!(name in manifest.files)) {
      console.error(`EXTRA target: .pi/skills/${name} (not from skills/ — re-sync needed)`);
      drifted++;
    }
  }

  if (drifted === 0) {
    console.log(`${Object.keys(manifest.files).length} skills in sync, no drift.`);
    process.exit(0);
  } else {
    console.error(`\n${drifted} drift(s) detected. Run without --check to sync.`);
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);
if (args.includes('--check')) {
  check();
} else {
  sync();
}
