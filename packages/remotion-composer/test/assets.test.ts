import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
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
  it('preserves original image bytes, including panoramas and portraits larger than twice the frame', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'composer-assets-'));
    try {
      for (const [file, width, height] of [['wide.png', 900, 100], ['tall.jpg', 100, 900], ['small.png', 160, 90]] as const) {
        const draw = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg',
          ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}`, '-frames:v', '1', path.join(root, file)], {encoding: 'utf8'});
        assert.equal(draw.status, 0, draw.stderr);
      }
      const doc = clone(fixture('explainer.json')) as EditTimeline;
      doc.profile = {...doc.profile, width: 160, height: 90};
      doc.assets = {};
      for (const name of ['wide.png', 'tall.jpg', 'small.png']) {
        doc.assets[name] = {path: name, hash: await sha256(path.join(root, name)), kind: 'image'};
      }
      const out = await stageAssets(doc, root);
      assert.ok(out.ok);
      try {
        // A kit may cover, crop, or zoom arbitrarily: the frame size alone
        // cannot bound the source pixels it needs, or justify a re-encode.
        for (const [id, asset] of Object.entries(doc.assets)) {
          assert.equal(await sha256(path.join(out.staged.publicDir, out.staged.files[id]!)), asset.hash, id);
          assert.equal(out.staged.sources[id], path.join(root, asset.path));
        }
      } finally {
        await out.staged.cleanup();
      }
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

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

  it('stages an asset from a shared root outside the episode, and nothing from elsewhere', async () => {
    // library/<channel>/themes/… beside library/<channel>/series/<s>/episodes/<e>
    const library = await episodeWith({'themes/t/1.0.0/rooms/hall.png': 'a hall', 'secrets/key.txt': 'no'});
    const episode = path.join(library, 'series/s/episodes/e');
    await mkdir(episode, {recursive: true});
    const doc = clone(fixture('explainer.json')) as EditTimeline;
    doc.assets = {
      'theme-hall': {path: '../../../../themes/t/1.0.0/rooms/hall.png', hash: await sha256(path.join(library, 'themes/t/1.0.0/rooms/hall.png')), kind: 'image'},
    };
    const shared = path.join(library, 'themes');
    const out = await stageAssets(doc, episode, [shared]);
    assert.ok(out.ok);
    if (!out.ok) return;
    assert.equal(await readFile(path.join(out.staged.publicDir, out.staged.files['theme-hall']!), 'utf8'), 'a hall');
    await out.staged.cleanup();
    // Without the shared root it is outside the episode; with it, a path beside it is still refused.
    const alone = await stageAssets(doc, episode);
    assert.deepEqual(alone.ok ? [] : alone.problems.map((p) => p.code), ['missing-asset']);
    // A link inside the shared root that leads elsewhere is not inside it.
    await symlink(path.join(library, 'secrets/key.txt'), path.join(library, 'themes/t/1.0.0/rooms/link.png'));
    doc.assets['theme-hall'] = {path: '../../../../themes/t/1.0.0/rooms/link.png', hash: await sha256(path.join(library, 'secrets/key.txt')), kind: 'image'};
    const linked = await stageAssets(doc, episode, [shared]);
    assert.deepEqual(linked.ok ? [] : linked.problems.map((p) => p.code), ['missing-asset']);
    doc.assets['theme-hall']!.path = '../../../../secrets/key.txt';
    const beside = await stageAssets(doc, episode, [shared]);
    assert.deepEqual(beside.ok ? [] : beside.problems.map((p) => p.code), ['missing-asset']);
    await rm(library, {recursive: true, force: true});
  });
});
