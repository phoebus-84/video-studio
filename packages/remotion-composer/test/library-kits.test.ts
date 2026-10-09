// Kits a channel or a series carries in the library (avg-d1x): loaded with the
// application's React, Remotion and zod, validated like the application's
// kits, locked by their bundle's hash, and registered by a generated entry.

import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ComposerError} from '../src/errors.js';
import {timelineKits} from '../src/kit-lock.js';
import {isApplicationKit, resolveKit} from '../src/kits/index.js';
import {libraryEntry, loadLibraryKit, readLibraryKits} from '../src/library-kits.js';
import {validateTimeline} from '../src/validate.js';
import {clone, fixture} from './helpers.js';
import {buildLibraryKit} from './library-kit-fixture.js';

/** The explainer's frame, drawn with one item of the sample kit. */
function cardTimeline(props: Record<string, unknown> = {text: 'from the library', color: '#1b2a4a'}) {
  const doc = clone(fixture('explainer.json'));
  doc.durationInFrames = 30;
  doc.assets = {};
  doc.tracks = [{id: 'main', type: 'visual', z: 0, items: [{id: 'card', from: 0, duration: 30, kit: {name: 'sample-card', version: '1.0.0'}, props}]}];
  return doc;
}

describe('library kits', () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), 'library-kits-')); });
  after(async () => { await rm(dir, {recursive: true, force: true}); });

  it('loads a sealed kit with the application’s packages and validates its props', async () => {
    const built = await buildLibraryKit(path.join(dir, 'sample'));
    const loaded = loadLibraryKit(built.file, built.bytes, built.hash);
    assert.ok(loaded.ok, !loaded.ok ? loaded.message : '');
    assert.equal(loaded.kit.name, 'sample-card');

    assert.equal(validateTimeline(cardTimeline()).ok, false, 'without the library kit the timeline names an unknown kit');
    assert.ok(validateTimeline(cardTimeline(), {kits: [loaded.kit]}).ok);
    const bad = validateTimeline(cardTimeline({text: 'x', color: 'red'}), {kits: [loaded.kit]});
    assert.deepEqual(!bad.ok && bad.problems.map((p) => p.code), ['bad-props']);
  });

  it('locks a library kit by its bundle’s hash', async () => {
    const built = await buildLibraryKit(path.join(dir, 'lock'));
    assert.equal(timelineKits(cardTimeline()), null);
    assert.deepEqual(timelineKits(cardTimeline(), [{name: 'sample-card', version: '1.0.0', hash: built.hash}]), [{name: 'sample-card', version: '1.0.0', hash: built.hash}]);
  });

  it('refuses a bundle that is not the sealed one, one that exports no kit, another name, and an application kit’s name', async () => {
    const built = await buildLibraryKit(path.join(dir, 'checks'));
    const code = async (kits: Parameters<typeof readLibraryKits>[0]) => {
      try {
        await readLibraryKits(kits);
        return 'ok';
      } catch (e) {
        assert.ok(e instanceof ComposerError);
        return `${e.code}: ${e.message}`;
      }
    };
    assert.equal(await code([{name: 'sample-card', version: '1.0.0', file: built.file, hash: built.hash}]), 'ok');
    assert.match(await code([{name: 'sample-card', version: '1.0.0', file: built.file, hash: `sha256:${'0'.repeat(64)}`}]), /^bad-kit: .*not the sealed bundle/);
    assert.match(await code([{name: 'other-card', version: '1.0.0', file: built.file, hash: built.hash}]), /^bad-kit: .*the bundle is sample-card@1\.0\.0/);
    assert.ok(isApplicationKit('still', '1.0.0'));
    assert.match(await code([{name: 'still', version: '1.0.0', file: built.file, hash: built.hash}]), /^bad-kit: still@1\.0\.0 is an application kit/);
    const empty = await buildLibraryKit(path.join(dir, 'empty'), {source: 'export const nothing = 1;\n'});
    assert.match(await code([{name: 'sample-card', version: '1.0.0', file: empty.file, hash: empty.hash}]), /^bad-kit: .*does not export a kit/);
  });

  it('writes a bundle entry that registers the library kits before the root, and keeps the package’s own without them', async () => {
    const built = await buildLibraryKit(path.join(dir, 'entry'));
    const own = await libraryEntry(dir, []);
    assert.equal(path.basename(own), 'remotion-entry.js');
    const entry = await libraryEntry(dir, [{name: 'sample-card', version: '1.0.0', file: built.file, hash: built.hash}]);
    const text = await readFile(entry, 'utf-8');
    assert.ok(text.indexOf('registerLibraryKits([kit0.kit])') < text.indexOf('registerRoot(RemotionRoot)'));
    assert.ok(text.includes(JSON.stringify(built.file)));
    // The application's own resolution never sees a library kit unless it is registered or handed.
    assert.equal(resolveKit('sample-card', '1.0.0'), undefined);
  });
});
