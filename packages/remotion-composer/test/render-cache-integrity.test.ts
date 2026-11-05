// The hash memo and the cache read keep "these bytes match the digest": the
// shortcut is taken only where the bytes cannot have changed unseen.

import {describe, it, mock} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire, syncBuiltinESMExports} from 'node:module';
import {mkdtemp, rename, rm, stat, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256Cached, VideoCache} from '../src/render-cache.js';
import {sha256} from '../src/assets.js';

const require = createRequire(import.meta.url);
const settle = () => new Promise((r) => setTimeout(r, 3200));

async function workspace(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'cache-integrity-'));
  try {
    await run(root);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

describe('sha256Cached', () => {
  it('reads again a file rewritten at the same size with its modification time put back', async () => workspace(async (root) => {
    const file = path.join(root, 'picture');
    await writeFile(file, 'AAAA');
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
    await settle();
    assert.equal(await sha256Cached(file), await sha256(file), 'remembered, once settled');
    const before = await stat(file);
    await writeFile(file, 'BBBB');
    await utimes(file, before.atime, before.mtime);
    assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
    assert.equal(await sha256Cached(file), await sha256(file), 'the change time gives it away');
  }));

  it('never remembers a file changed in the last seconds', async () => workspace(async (root) => {
    const file = path.join(root, 'fresh');
    await writeFile(file, 'one');
    assert.equal(await sha256Cached(file), await sha256(file));
    await writeFile(file, 'two');
    assert.equal(await sha256Cached(file), await sha256(file));
  }));
});

describe('VideoCache.read', () => {
  it('checks the copy when the entry was replaced between the check and the copy', async () => workspace(async (root) => {
    const warnings: string[] = [];
    const cache = new VideoCache(path.join(root, 'cache'), warnings);
    const source = path.join(root, 'source');
    await writeFile(source, 'segment A');
    await cache.put('key', source);
    const other = path.join(root, 'other');
    await writeFile(other, 'segment B, another writer');
    // Another writer's rename lands just before the copy.
    const fsp = require('node:fs/promises') as typeof import('node:fs/promises');
    const copy = fsp.copyFile;
    const swapped = mock.method(fsp, 'copyFile', async (from: string, to: string) => {
      if (from.endsWith('key.mp4')) await rename(other, from);
      return copy(from, to);
    });
    syncBuiltinESMExports();
    try {
      const dest = path.join(root, 'dest');
      assert.equal(await cache.get('key', dest), false, 'bytes that were not checked are not a hit');
      assert.ok(warnings.some((w) => /changed while it was read/.test(w)));
      await assert.rejects(stat(dest), {code: 'ENOENT'});
    } finally {
      swapped.mock.restore();
      syncBuiltinESMExports();
    }
  }));
});
