// What draws a sheet's pictures besides the timeline (avg-3th.1): this
// package's own code — the compositions, the kits and the helpers they share —
// and the Remotion and React versions it draws with. A layout sheet records
// it, so a composer upgrade makes the sheet stale even when no kit version
// changed.

import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const CODE = /\.(js|ts|tsx|json)$/;

function codeFiles(dir: string, base = dir): [string, string][] {
  const rows: [string, string][] = [];
  for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...codeFiles(full, base));
    else if (entry.isFile() && CODE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      rows.push([path.relative(base, full).split(path.sep).join('/'), createHash('sha256').update(readFileSync(full)).digest('hex')]);
    }
  }
  return rows;
}

function dependencies(): [string, string][] {
  const require = createRequire(import.meta.url);
  return ['remotion', '@remotion/renderer', '@remotion/bundler', 'react', 'react-dom']
    .map((name) => [name, (JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')) as {version: string}).version]);
}

const own = path.dirname(fileURLToPath(import.meta.url));
let ownHash: string | undefined;

/**
 * "sha256:…" of every code file under `dir` (default: this package's own
 * built code) and of the Remotion and React versions. The package's own
 * hash is computed once per process.
 */
export function drawingCodeHash(dir: string = own): string {
  if (dir === own && ownHash) return ownHash;
  const hash = `sha256:${createHash('sha256').update(JSON.stringify({code: codeFiles(dir), dependencies: dependencies()})).digest('hex')}`;
  if (dir === own) ownHash = hash;
  return hash;
}
