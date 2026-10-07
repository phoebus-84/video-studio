#!/usr/bin/env node
// layout-sheet <timeline.json> <out-dir> --assets <dir> --times <s,s,…> [--scale <0..1>] [--columns <n>]
// A timeline's layout sheet at the given seconds. An episode's own sheet, at
// its series' instants, is the studio's (the pipeline's sheet stage, or the
// agent); this renders any timeline at any times.

import {readFile} from 'node:fs/promises';
import {ComposerError, renderLayoutSheet} from './index.js';

const args = process.argv.slice(2);
const VALUE_FLAGS = ['--assets', '--times', '--scale', '--columns'];
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1] ?? ''));
const [timelinePath, outDir] = positional;
const assetRoot = flag('--assets');
const times = flag('--times');
if (!timelinePath || !outDir || !assetRoot || !times) {
  console.error('Usage: layout-sheet <timeline.json> <out-dir> --assets <dir> --times <s,s,…> [--scale <0..1>] [--columns <n>]');
  process.exit(1);
}

try {
  const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as {fps?: unknown};
  const fps = typeof timeline.fps === 'number' ? timeline.fps : 0;
  const picks = times.split(',').map((t) => ({frame: Math.round(Number(t) * fps), label: `${t}s`}));
  const scale = flag('--scale');
  const columns = flag('--columns');
  const result = await renderLayoutSheet({
    timeline, assetRoot, outDir, picks,
    ...(scale ? {scale: Number(scale)} : {}),
    ...(columns ? {columns: Number(columns)} : {}),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  if (e instanceof ComposerError) {
    console.error(`${e.code}: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
