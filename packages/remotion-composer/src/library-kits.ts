// ---------------------------------------------------------------------------
// Kits a channel or a series carries in the library (avg-d1x)
// ---------------------------------------------------------------------------
// A kit release holds a self-contained CommonJS bundle (`kit.cjs`, sealed by
// `vpr kit seal`) exporting `kit`, a KitVersion. React, Remotion and zod stay
// external: the kit draws with the application's own, in Node (props
// validation) and in the Remotion bundle (drawing).
// ---------------------------------------------------------------------------

import Module from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ComposerError} from './errors.js';
import {isApplicationKit} from './kits/index.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {KitVersion} from './kits/types.js';

/** A library kit as a render receives it: where its sealed bundle is, and that bundle's hash. */
export interface LibraryKit {
  name: string;
  version: string;
  /** Absolute path of the sealed kit.cjs. */
  file: string;
  /** "sha256:…" of its bytes. */
  hash: string;
}

const own = path.dirname(fileURLToPath(import.meta.url));
/** Where the kit's external packages resolve from: this package's node_modules and its ancestors'. */
const modulePaths = (Module as unknown as {_nodeModulePaths(dir: string): string[]})._nodeModulePaths(own);
const loaded = new Map<string, KitVersion>();

/**
 * The KitVersion a sealed kit bundle exports, run from the bytes whose hash
 * the caller checked, or why it is not one. One module per hash.
 */
export function loadLibraryKit(file: string, bytes: Buffer, hash: string): {ok: true; kit: KitVersion} | {ok: false; message: string} {
  const hit = loaded.get(hash);
  if (hit) return {ok: true, kit: hit};
  let exports: Record<string, unknown>;
  try {
    const ModuleCtor = Module as unknown as new (id: string) => {filename: string; paths: string[]; exports: Record<string, unknown>; _compile(code: string, file: string): void};
    const m = new ModuleCtor(file);
    m.filename = file;
    m.paths = modulePaths;
    m._compile(bytes.toString('utf-8'), file);
    exports = m.exports;
  } catch (e) {
    return {ok: false, message: `it does not load: ${e instanceof Error ? e.message : String(e)}`};
  }
  const kit = exports.kit as Partial<KitVersion> | undefined;
  if (!kit || typeof kit.name !== 'string' || typeof kit.version !== 'string' || typeof kit.component !== 'function' || !kit.props || typeof (kit.props as {safeParse?: unknown}).safeParse !== 'function') {
    return {ok: false, message: 'it does not export a kit (`export const kit` with name, version, props and component)'};
  }
  loaded.set(hash, kit as KitVersion);
  return {ok: true, kit: kit as KitVersion};
}

/**
 * The bundle entry for a render with library kits: the application's root,
 * with the kits registered first. Written into `dir`; returns its path.
 * Without library kits the package's own entry is used as before.
 */
export async function libraryEntry(dir: string, kits: readonly LibraryKit[]): Promise<string> {
  if (kits.length === 0) return path.join(own, 'remotion-entry.js');
  const lines = [
    `import {registerRoot} from 'remotion';`,
    `import {registerLibraryKits} from ${JSON.stringify(path.join(own, 'kits', 'index.js'))};`,
    `import {RemotionRoot} from ${JSON.stringify(path.join(own, 'Root.js'))};`,
    ...kits.map((k, i) => `import * as kit${i} from ${JSON.stringify(k.file)};`),
    `registerLibraryKits([${kits.map((_, i) => `kit${i}.kit`).join(', ')}]);`,
    `registerRoot(RemotionRoot);`,
  ];
  const entry = path.join(dir, 'library-entry.js');
  await writeFile(entry, `${lines.join('\n')}\n`);
  return entry;
}

/** A webpack override letting the library kits' external packages resolve from the application. */
export function resolveFromApplication<T extends {resolve?: {modules?: string[]}}>(config: T): T {
  return {...config, resolve: {...config.resolve, modules: [...(config.resolve?.modules ?? ['node_modules']), ...modulePaths]}};
}

/**
 * The library kits a render is handed, loaded and checked: each bundle's
 * bytes are the sealed ones, it exports the kit it is named as, and no
 * library kit takes an application kit's name@version.
 */
export async function readLibraryKits(kits: readonly LibraryKit[]): Promise<KitVersion[]> {
  const out: KitVersion[] = [];
  for (const k of kits) {
    const label = `${k.name}@${k.version}`;
    if (isApplicationKit(k.name, k.version)) throw new ComposerError('bad-kit', `${label} is an application kit: a library kit takes another name or version`);
    let bytes: Buffer;
    try {
      bytes = await readFile(k.file);
    } catch {
      throw new ComposerError('bad-kit', `${label}: ${k.file} is missing`);
    }
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== k.hash) throw new ComposerError('bad-kit', `${label}: ${k.file} is not the sealed bundle`);
    const loadedKit = loadLibraryKit(k.file, bytes, k.hash);
    if (!loadedKit.ok) throw new ComposerError('bad-kit', `${label}: ${loadedKit.message}`);
    if (loadedKit.kit.name !== k.name || loadedKit.kit.version !== k.version) {
      throw new ComposerError('bad-kit', `${label}: the bundle is ${loadedKit.kit.name}@${loadedKit.kit.version}`);
    }
    out.push(loadedKit.kit);
  }
  return out;
}
