// The bundle a render serves, built once per code. Webpack took one to two
// seconds a render, twice in a shared render (the drawing and the assembly),
// for code that had not changed: a correction paid it on every run. The code
// is bundled with an empty public directory and kept in a folder named by
// what it is (the entry, which names the library kits, and the drawing code
// with its Remotion and React versions); a render links those files into its
// own work directory and its staged assets beside them, as the bundler would
// have copied them. The page's list of public files stays empty: nothing here
// reads it (getStaticFiles), and the files are served by path.
//
// Webpack runs in a worker thread, so the process keeps answering while it
// bundles: a shared render's pipes and progress do not stall behind it.

import {createHash} from 'node:crypto';
import {copyFile, link, mkdir, readdir, rename, rm, stat, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {drawingCodeHash} from './identity.js';

export interface BundleRequest {
  entryPoint: string;
  /** Library kits: their external packages resolve from the application. */
  withKits: boolean;
}

/** How many bundles stay on disk, the most recently used. */
const KEEP = 6;
const defaultRoot = () => path.join(tmpdir(), 'av-bundles');
const building = new Map<string, Promise<string>>();

/** What builds a bundle, and where bundles are kept: webpack and the temp folder, but for tests. */
export interface BundleCacheUsing {
  build?: (request: BundleRequest, publicDir: string, outDir: string) => Promise<void>;
  root?: string;
}

/** The bundle for `request` at `outDir`, with `publicDir`'s files under its `public/`; returns the serve URL. */
export async function bundleInto(request: BundleRequest, publicDir: string, outDir: string): Promise<string> {
  const code = await cachedBundle(request);
  await linkTree(code, outDir);
  await linkTree(publicDir, path.join(outDir, 'public'));
  return outDir;
}

/**
 * The folder holding the code-only bundle for `request`, built if no render
 * built it yet. A bundle this process remembers is used only while it is
 * still on disk: prune() (here, or in another process sharing the folder)
 * may have removed it since, and it is then built again rather than handed
 * out as a path that is gone. Each use marks it recently used, so the
 * bundle a long session keeps using is not the one pruned.
 */
export async function cachedBundle(request: BundleRequest, using: BundleCacheUsing = {}): Promise<string> {
  const root = using.root ?? defaultRoot();
  const key = createHash('sha256').update(JSON.stringify([root, request.entryPoint, request.withKits, drawingCodeHash()])).digest('hex').slice(0, 16);
  for (;;) {
    const pending = building.get(key);
    if (!pending) {
      const started = findOrBuild(root, key, request, using.build ?? bundleElsewhere);
      building.set(key, started);
      started.catch(() => {
        if (building.get(key) === started) building.delete(key);
      });
      return started;
    }
    // A failed build fails every render that waited on it.
    const dir = await pending;
    if (await complete(dir)) {
      await touch(dir);
      return dir;
    }
    if (building.get(key) === pending) building.delete(key);
  }
}

const touch = async (dir: string) => {
  const now = new Date();
  await utimes(dir, now, now).catch(() => {});
};

async function findOrBuild(root: string, key: string, request: BundleRequest,
  build: NonNullable<BundleCacheUsing['build']>): Promise<string> {
  const dir = path.join(root, key);
  if (await complete(dir)) {
    await touch(dir);
    return dir;
  }
  const temp = path.join(root, `.${key}.${process.pid}.${Date.now()}`);
  const empty = path.join(temp, 'empty-public');
  const out = path.join(temp, 'bundle');
  await mkdir(empty, {recursive: true});
  try {
    await build(request, empty, out);
    await rm(path.join(out, 'public'), {recursive: true, force: true});
    try {
      await rename(out, dir);
    } catch (e) {
      // Another render, beside this one, built the same code first: keep its.
      if (!(await complete(dir))) throw e;
    }
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
  await prune(root);
  return dir;
}

const complete = (dir: string) => stat(path.join(dir, 'index.html')).then(() => true, () => false);

/** Webpack in a worker thread; where a worker cannot start, in this one. */
async function bundleElsewhere(request: BundleRequest, publicDir: string, outDir: string): Promise<void> {
  const extension = path.extname(fileURLToPath(import.meta.url));
  const data = {entryPoint: request.entryPoint, withKits: request.withKits, publicDir, outDir};
  const answer = await new Promise<{ok: boolean; message?: string} | null>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL(`./bundle-worker${extension}`, import.meta.url), {workerData: data});
    } catch {
      resolve(null);
      return;
    }
    worker.once('message', (m: {ok: boolean; message?: string}) => resolve(m));
    worker.once('error', () => resolve(null));
    worker.once('exit', () => resolve(null));
  });
  if (answer?.ok) return;
  if (answer) throw new Error(answer.message);
  const {bundleCode} = await import('./bundle-worker-code.js');
  await bundleCode(data);
}

/** `from`'s files at `to`, hard-linked where the filesystem allows it, copied where not. */
async function linkTree(from: string, to: string): Promise<void> {
  await mkdir(to, {recursive: true});
  for (const entry of await readdir(from, {withFileTypes: true})) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await linkTree(source, target);
    else await link(source, target).catch(() => copyFile(source, target));
  }
}

/** Removes all but the most recently used bundles. */
async function prune(root: string): Promise<void> {
  const names = (await readdir(root).catch(() => [] as string[])).filter((n) => !n.startsWith('.'));
  const dated = await Promise.all(names.map(async (n) => ({n, t: (await stat(path.join(root, n)).catch(() => null))?.mtimeMs ?? 0})));
  for (const {n} of dated.sort((a, b) => b.t - a.t).slice(KEEP)) await rm(path.join(root, n), {recursive: true, force: true}).catch(() => {});
}
