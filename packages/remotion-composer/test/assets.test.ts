import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sha256, stageAssets} from '../src/assets.js';
import {clone, fixture} from './helpers.js';
import type {EditTimeline} from '../src/schema.js';

async function episodeWith(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'composer-assets-'));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), {recursive: true});
    await writeFile(path.join(root, rel), content);
  }
  return root;
}

/** The explainer, with its three images present and hashed. */
async function explainer() {
  const doc = clone(fixture('explainer.json')) as EditTimeline;
  const root = await episodeWith(Object.fromEntries(Object.values(doc.assets).map((a, i) => [a.path, `image ${i}`])));
  for (const asset of Object.values(doc.assets)) asset.hash = await sha256(path.join(root, asset.path));
  return {doc, root};
}

describe('stageAssets', () => {
  it('stages every verified asset under its id', async () => {
    const {doc, root} = await explainer();
    const out = await stageAssets(doc, root);
    assert.ok(out.ok);
    if (!out.ok) return;
    assert.deepEqual(out.staged.files, {
      'scene-01-woods': 'assets/0-scene-01-woods.png',
      'scene-02-grandma': 'assets/1-scene-02-grandma.png',
      'scene-03-ending': 'assets/2-scene-03-ending.png',
    });
    assert.equal(await readFile(path.join(out.staged.publicDir, out.staged.files['scene-02-grandma']!), 'utf8'), 'image 1');
    await out.staged.cleanup();
    await rm(root, {recursive: true, force: true});
  });

  it('never lets two assets share a staged name, even ids that differ only by case', async () => {
    const root = await episodeWith({'a/intro.png': 'one', 'b/intro.png': 'two'});
    const doc = clone(fixture('explainer.json')) as EditTimeline;
    doc.assets = {
      Intro: {path: 'a/intro.png', hash: await sha256(path.join(root, 'a/intro.png')), kind: 'image'},
      intro: {path: 'b/intro.png', hash: await sha256(path.join(root, 'b/intro.png')), kind: 'image'},
    };
    const out = await stageAssets(doc, root);
    assert.ok(out.ok);
    if (!out.ok) return;
    const names = Object.values(out.staged.files).map((n) => n.toLowerCase());
    assert.equal(new Set(names).size, 2);
    assert.equal(await readFile(path.join(out.staged.publicDir, out.staged.files.Intro!), 'utf8'), 'one');
    assert.equal(await readFile(path.join(out.staged.publicDir, out.staged.files.intro!), 'utf8'), 'two');
    await out.staged.cleanup();
    await rm(root, {recursive: true, force: true});
  });

  it('refuses a missing file, a different file, and a path outside the episode', async () => {
    const {doc, root} = await explainer();
    await rm(path.join(root, doc.assets['scene-01-woods']!.path));
    await writeFile(path.join(root, doc.assets['scene-02-grandma']!.path), 'edited');
    doc.assets['scene-03-ending']!.path = '../../etc/hosts';
    const out = await stageAssets(doc, root);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.problems.map((p) => [p.code, p.path]), [
      ['missing-asset', '$.assets["scene-01-woods"].path'],
      ['hash-mismatch', '$.assets["scene-02-grandma"].hash'],
      ['missing-asset', '$.assets["scene-03-ending"].path'],
    ]);
    await rm(root, {recursive: true, force: true});
  });
});
