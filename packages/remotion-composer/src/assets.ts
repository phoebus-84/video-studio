// Verify every declared asset and stage it for Remotion: files are checked
// against their hash (a different file is an error, never a silent
// re-render), then hard-linked (copied when linking fails) into a temporary
// public directory, named by asset id, that the bundle serves.

import {createHash} from 'node:crypto';
import {createReadStream, existsSync} from 'node:fs';
import {copyFile, link, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {EditTimeline} from './schema.js';
import type {ComposerProblem} from './errors.js';

export async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}

export interface StagedAssets {
  publicDir: string;
  /** Asset id → file name inside publicDir, for staticFile(). */
  files: Record<string, string>;
  /** Asset id → absolute source path. */
  sources: Record<string, string>;
  cleanup: () => Promise<void>;
}

export async function stageAssets(
  timeline: EditTimeline, assetRoot: string,
): Promise<{ok: true; staged: StagedAssets} | {ok: false; problems: ComposerProblem[]}> {
  const root = path.resolve(assetRoot);
  const problems: ComposerProblem[] = [];
  const sources: Record<string, string> = {};
  for (const [id, asset] of Object.entries(timeline.assets)) {
    const p = `$.assets[${JSON.stringify(id)}]`;
    const abs = path.resolve(root, asset.path);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !existsSync(abs)) {
      problems.push({code: 'missing-asset', message: `asset "${id}": ${asset.path} is not a file under ${root}`, path: `${p}.path`});
      continue;
    }
    const actual = await sha256(abs);
    if (actual !== asset.hash) {
      problems.push({code: 'hash-mismatch', message: `asset "${id}": ${asset.path} is ${actual}, the timeline says ${asset.hash}`, path: `${p}.hash`});
      continue;
    }
    sources[id] = abs;
  }
  if (problems.length > 0) return {ok: false, problems};

  const publicDir = await mkdtemp(path.join(tmpdir(), 'remotion-composer-'));
  await mkdir(path.join(publicDir, 'assets'));
  const files: Record<string, string> = {};
  // The index makes every name unique, even ids that differ only by case on a
  // case-insensitive filesystem, or `x` with a.mp3 beside `x.mp3` without one.
  for (const [index, [id, abs]] of Object.entries(sources).entries()) {
    const name = `assets/${index}-${id}${path.extname(abs)}`;
    const target = path.join(publicDir, name);
    try {
      await link(abs, target);
    } catch {
      await copyFile(abs, target);
    }
    files[id] = name;
  }
  return {ok: true, staged: {publicDir, files, sources, cleanup: () => rm(publicDir, {recursive: true, force: true})}};
}
