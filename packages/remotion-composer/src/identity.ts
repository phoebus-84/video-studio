// What draws a sheet's pictures besides the timeline (avg-3th.1): this
// package's own code — the compositions, the kits and the helpers they share,
// not the modules that never draw (NOT_DRAWING, avg-dcf.6.13) — and the
// Remotion and React versions it draws with. A layout sheet records
// it, so a composer upgrade makes the sheet stale even when no kit version
// changed.

import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const CODE = /\.(js|ts|tsx|json)$/;

/**
 * The modules whose code never changes a frame (avg-dcf.6.13): the rendered
 * file's checks, the final file's sound, per-frame audio gain, and the Node
 * side that only decides how drawn frames are encoded, cut into cached
 * segments and joined (cached-render, render-cache) or how the command lines
 * call the renderer (cli, sheet-cli). A sheet stays current when only these
 * change: a faster render must not send a person back to re-read pictures that
 * did not change. The render cache still keys on the encoding modules
 * (ENCODING): they change the bytes of a segment. Not the probe: it counts a
 * clip's frames, which decide when the clip holds or loops. Every other
 * module counts as drawing until it is named here.
 */
export const NOT_DRAWING: ReadonlySet<string> = new Set(['audit', 'loudness', 'volume', 'cached-render', 'render-cache', 'cli', 'sheet-cli']);

/** The modules that never draw but decide a cached segment's bytes: the render cache keys on them. */
export const ENCODING: ReadonlySet<string> = new Set(['cached-render', 'render-cache']);

/**
 * Whether a code file can change what a frame shows. `file` is its path from
 * the package's code root (src/ or its build): only a top-level module can be
 * one that never draws — a kit is always drawing, whatever its name.
 */
export function drawsPictures(file: string): boolean {
  if (/[\\/]/.test(file)) return true;
  return !NOT_DRAWING.has(moduleName(file));
}

const moduleName = (file: string) => file.replace(/\.(tsx?|jsx?|json)$/, '');

/** Whether a code file can change a cached segment's bytes: what draws, and how it is encoded and cut. */
export function shapesSegments(file: string): boolean {
  return drawsPictures(file) || ENCODING.has(moduleName(file));
}

function codeFiles(dir: string, base = dir): [string, string][] {
  const rows: [string, string][] = [];
  for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...codeFiles(full, base));
    else if (entry.isFile() && CODE.test(entry.name) && !entry.name.endsWith('.d.ts') && drawsPictures(path.relative(base, full))) {
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
