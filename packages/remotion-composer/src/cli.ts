#!/usr/bin/env node
// render-timeline <timeline.json> <out.mp4> --assets <dir> [--concurrency <n>]

import {readFile} from 'node:fs/promises';
import {ComposerError, renderTimeline} from './index.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !['--assets', '--concurrency'].includes(args[i - 1] ?? ''));
const [timelinePath, outputPath] = positional;
const assetRoot = flag('--assets');
if (!timelinePath || !outputPath || !assetRoot) {
  console.error('Usage: render-timeline <timeline.json> <out.mp4> --assets <dir> [--concurrency <n>]');
  process.exit(1);
}

try {
  const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as unknown;
  const concurrency = flag('--concurrency');
  const result = await renderTimeline({
    timeline, assetRoot, outputPath,
    ...(concurrency ? {concurrency: Number(concurrency)} : {}),
    onProgress: (p) => process.stderr.write(`\rrendering ${Math.round(p * 100)}%`),
  });
  process.stderr.write('\n');
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  process.stderr.write('\n');
  if (e instanceof ComposerError) {
    console.error(`${e.code}: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
