// The bundle cache's bookkeeping, without webpack: a fake build writes the
// index.html a finished bundle has.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cachedBundle, type BundleCacheUsing} from '../src/bundle-cache.js';

function fakeBuilds(): BundleCacheUsing & {count: number} {
  const using = {
    count: 0,
    build: async (_request: unknown, _publicDir: string, outDir: string) => {
      using.count++;
      await mkdir(outDir, {recursive: true});
      await writeFile(path.join(outDir, 'index.html'), '<html></html>');
    },
  };
  return using;
}

describe('cachedBundle', () => {
  it('builds a bundle once per code', async () => {
    const builds = fakeBuilds();
    const using = {...builds, root: await mkdtemp(path.join(tmpdir(), 'bundle-cache-'))};
    const request = {entryPoint: '/code/entry-once.js', withKits: false};
    const [a, b] = await Promise.all([cachedBundle(request, using), cachedBundle(request, using)]);
    assert.equal(a, b);
    assert.equal(await cachedBundle(request, using), a);
    assert.equal(builds.count, 1);
  });

  it('builds a pruned bundle again instead of handing out a path that is gone', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bundle-cache-'));
    const using = fakeBuilds();
    const request = (i: number) => ({entryPoint: `/code/entry-${i}.js`, withKits: false});
    const first = await cachedBundle(request(0), {...using, root});
    // Six more bundles: the first is the oldest past the six kept.
    for (let i = 1; i <= 6; i++) {
      await new Promise((r) => setTimeout(r, 15));
      await cachedBundle(request(i), {...using, root});
    }
    assert.equal(existsSync(first), false, 'the oldest bundle was pruned');
    const again = await cachedBundle(request(0), {...using, root});
    assert.equal(again, first);
    assert.ok(existsSync(path.join(again, 'index.html')), 'and is on disk again');
  });

  it('a bundle in use is the most recently used: it is not the one pruned', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bundle-cache-'));
    const using = fakeBuilds();
    const request = (i: number) => ({entryPoint: `/code/used-${i}.js`, withKits: false});
    const used = await cachedBundle(request(0), {...using, root});
    for (let i = 1; i <= 6; i++) {
      await new Promise((r) => setTimeout(r, 15));
      await cachedBundle(request(i), {...using, root});
      await cachedBundle(request(0), {...using, root});
    }
    assert.ok(existsSync(path.join(used, 'index.html')));
  });
});
