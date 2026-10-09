// ---------------------------------------------------------------------------
// Kits a channel or a series carries in the library (avg-d1x)
// ---------------------------------------------------------------------------
// A kit release holds a self-contained CommonJS bundle (`kit.cjs`, sealed by
// `vpr kit seal`) exporting `kit`, a KitVersion. React, Remotion and zod stay
// external: the kit draws with the application's own, in Node (props
// validation) and in the Remotion bundle (drawing).
// ---------------------------------------------------------------------------

import Module from 'node:module';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
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

/** Library kits read and checked for a render: their KitVersions, and the exact bytes that were hashed. */
export interface CheckedKits {
  versions: KitVersion[];
  sources: {kit: LibraryKit; bytes: Buffer}[];
}

/**
 * The bundle entry for a render with library kits: the application's root,
 * with the kits registered first. It and copies of the checked bytes go in a
 * folder named by what they are (this package and the kits' hashes), so the
 * bundle — which names its modules by path — is the same render after render
 * and the render cache keeps hitting; and webpack reads the bytes that were
 * hashed, not the library's file again. Without library kits the package's
 * own entry is used as before.
 */
export async function libraryEntry(checked: CheckedKits): Promise<string> {
  if (checked.sources.length === 0) return path.join(own, 'remotion-entry.js');
  const key = createHash('sha256').update(JSON.stringify([own, checked.sources.map((s) => s.kit.hash)])).digest('hex').slice(0, 16);
  const dir = path.join(tmpdir(), 'av-library-entries', key);
  await mkdir(dir, {recursive: true});
  const lines = [
    `import {registerRoot} from 'remotion';`,
    `import {registerLibraryKits} from ${JSON.stringify(path.join(own, 'kits', 'index.js'))};`,
    `import {RemotionRoot} from ${JSON.stringify(path.join(own, 'Root.js'))};`,
    ...checked.sources.map((_, i) => `import * as kit${i} from './kit-${i}.cjs';`),
    `registerLibraryKits([${checked.sources.map((_, i) => `kit${i}.kit`).join(', ')}]);`,
    `registerRoot(RemotionRoot);`,
  ];
  // Written whole, then renamed: a render beside this one reads a complete file or none.
  const put = async (name: string, content: string | Buffer) => {
    const temp = path.join(dir, `.${name}.${process.pid}.tmp`);
    await writeFile(temp, content);
    await rename(temp, path.join(dir, name));
  };
  for (const [i, source] of checked.sources.entries()) await put(`kit-${i}.cjs`, source.bytes);
  await put('library-entry.js', `${lines.join('\n')}\n`);
  return path.join(dir, 'library-entry.js');
}

/**
 * A webpack override letting the library kits' external packages resolve from
 * the application — first, so a node_modules beside a kit never brings a
 * second React, Remotion or zod.
 */
export function resolveFromApplication<T extends {resolve?: {modules?: string[]}}>(config: T): T {
  return {...config, resolve: {...config.resolve, modules: [...modulePaths, ...(config.resolve?.modules ?? ['node_modules'])]}};
}

/**
 * The library kits a render is handed, loaded and checked: each bundle's
 * bytes are the sealed ones, it exports the kit it is named as, no two share
 * a name@version, and none takes an application kit's.
 */
export async function readLibraryKits(kits: readonly LibraryKit[]): Promise<CheckedKits> {
  const checked: CheckedKits = {versions: [], sources: []};
  const seen = new Set<string>();
  for (const k of kits) {
    const label = `${k.name}@${k.version}`;
    if (seen.has(label)) throw new ComposerError('bad-kit', `${label} is handed twice: one kit per name@version`);
    seen.add(label);
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
    checked.versions.push(loadedKit.kit);
    checked.sources.push({kit: k, bytes});
  }
  return checked;
}
