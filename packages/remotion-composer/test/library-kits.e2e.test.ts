// A library kit drawn for real (avg-d1x): a layout sheet of a timeline whose
// only item is a kit built outside this package. Slow, and it needs headless
// Chrome: only with REMOTION_E2E=1, against the build in dist/.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {clone, fixture} from './helpers.js';
import {buildLibraryKit} from './library-kit-fixture.js';

const enabled = process.env.REMOTION_E2E === '1';

/** The colour at the still's centre, as "#rrggbb". */
function centre(file: string): string {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'crop=2:2:iw/2:ih/2,format=rgb24,scale=1:1', '-f', 'rawvideo', '-'], {maxBuffer: 1 << 20});
  assert.equal(out.status, 0, out.stderr?.toString());
  return `#${[...out.stdout.subarray(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

describe('a library kit in a real layout sheet', {skip: !enabled && 'set REMOTION_E2E=1 to render'}, () => {
  it('draws the kit with the application\'s React and Remotion, and locks it by its hash', async () => {
    const {renderLayoutSheet} = await import('../dist/index.js');
    const root = await mkdtemp(path.join(tmpdir(), 'library-kit-sheet-'));
    try {
      const built = await buildLibraryKit(path.join(root, 'channel', 'kits', 'sample-card', '1.0.0'));
      const doc = clone(fixture('explainer.json'));
      doc.durationInFrames = 30;
      doc.assets = {};
      doc.tracks = [{id: 'main', type: 'visual', z: 0, items: [{id: 'card', from: 0, duration: 30, kit: {name: 'sample-card', version: '1.0.0'}, props: {text: '', color: '#1b2a4a'}}]}];
      const kits = [{name: 'sample-card', version: '1.0.0', file: built.file, hash: built.hash}];
      const result = await renderLayoutSheet({timeline: doc, assetRoot: root, picks: [{frame: 12, label: 'card'}], outDir: path.join(root, 'sheet'), kits});
      assert.deepEqual(result.kits, [{name: 'sample-card', version: '1.0.0', hash: built.hash}]);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(centre(result.frames[0]!.path).slice(i, i + 2), 16));
      // JPEG: near the card's colour, not exactly it.
      assert.ok(Math.abs(r! - 0x1b) < 8 && Math.abs(g! - 0x2a) < 8 && Math.abs(b! - 0x4a) < 8, `centre is ${centre(result.frames[0]!.path)}`);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
