// npm run kits:lock      add new kit versions to kits.lock.json (never rewrites an entry)
// npm run kits:previews  render previews/<name>@<version>.png (first example, 640x360)

import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {copyFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderStill, selectComposition} from '@remotion/renderer';
import {KIT_VERSIONS, previewCompositionId} from '../src/kits/index.js';
import {bundlePreviews} from '../src/preview-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockFile = path.join(root, 'kits.lock.json');
const sourceOf = (name: string, version: string) => path.join(root, 'src/kits', name, `${version}.tsx`);
const hash = (file: string) => `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;

async function lock() {
  const current: Record<string, string> = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : {};
  const next = {...current};
  for (const kit of KIT_VERSIONS) {
    const id = `${kit.name}@${kit.version}`;
    const actual = hash(sourceOf(kit.name, kit.version));
    if (current[id] && current[id] !== actual) {
      throw new Error(`${id} is released and its file changed: restore it and add a new version instead`);
    }
    if (!current[id]) {
      next[id] = actual;
      console.log(`locked ${id}`);
    }
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(lockFile, JSON.stringify(sorted, null, 2) + '\n');
}

async function previews() {
  const work = await mkdtemp(path.join(tmpdir(), 'kit-previews-'));
  try {
    const serveUrl = await bundlePreviews(path.join(work, 'bundle'));
    // Render all first, then copy: a failure halfway leaves previews/ as it was.
    const rendered: [string, string][] = [];
    for (const kit of KIT_VERSIONS) {
      const example = kit.examples[0]!;
      const id = previewCompositionId(kit.name, kit.version, example.id);
      const composition = await selectComposition({serveUrl, id, inputProps: {}});
      const file = `${kit.name}@${kit.version}.png`;
      await renderStill({composition, serveUrl, output: path.join(work, file), frame: example.frame, scale: 1 / 3, imageFormat: 'png'});
      rendered.push([path.join(work, file), path.join(root, 'previews', file)]);
    }
    for (const [from, to] of rendered) {
      await copyFile(from, to);
      console.log(`rendered ${path.relative(root, to)}`);
    }
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

const command = process.argv[2];
if (command === 'lock') await lock();
else if (command === 'previews') await previews();
else {
  console.error('Usage: node --import tsx scripts/kits.ts lock|previews');
  process.exit(1);
}
