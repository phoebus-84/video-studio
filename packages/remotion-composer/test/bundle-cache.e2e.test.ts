// The cached bundle (bundle-cache): webpack once per code, then only links.
// Real webpack: only with REMOTION_E2E=1, against the build in dist/.

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const enabled = process.env.REMOTION_E2E === '1';
const files = async (dir: string): Promise<string[]> =>
  (await readdir(dir, {recursive: true, withFileTypes: true})).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name))).sort();

describe('bundleInto', {skip: !enabled && 'set REMOTION_E2E=1 to bundle'}, () => {
  let work: string;
  before(async () => {
    work = await mkdtemp(path.join(tmpdir(), 'composer-bundle-cache-'));
  });
  after(async () => {
    await rm(work, {recursive: true, force: true});
  });

  it('bundles the code once and gives each render its own folder with its public files', async () => {
    const {bundleInto} = await import('../dist/bundle-cache.js');
    const entryPoint = path.resolve('dist/remotion-entry.js');
    const publics = [path.join(work, 'public-a'), path.join(work, 'public-b')];
    for (const [i, dir] of publics.entries()) {
      await mkdir(path.join(dir, 'assets'), {recursive: true});
      await writeFile(path.join(dir, 'assets', `${i}.txt`), `asset ${i}`);
    }
    await bundleInto({entryPoint, withKits: false}, publics[0], path.join(work, 'a'));
    const started = Date.now();
    const b = await bundleInto({entryPoint, withKits: false}, publics[1], path.join(work, 'b'));
    assert.ok(Date.now() - started < 1000, 'the second bundle of the same code must not run webpack');
    assert.equal(b, path.join(work, 'b'));

    const code = (list: string[]) => list.filter((f) => !f.startsWith('public'));
    const [inA, inB] = [await files(path.join(work, 'a')), await files(path.join(work, 'b'))];
    assert.ok(inB.includes('index.html'));
    assert.deepEqual(code(inA), code(inB));
    assert.ok(inA.includes(path.join('public', 'assets', '0.txt')) && !inA.includes(path.join('public', 'assets', '1.txt')));
    assert.equal(await readFile(path.join(work, 'b', 'public', 'assets', '1.txt'), 'utf8'), 'asset 1');
  });
});
