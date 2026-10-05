import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {visualLayers} from '../src/layers.js';
import {clone, fixture} from './helpers.js';

describe('visualLayers', () => {
  it('draws tracks by z and, within a track, later items above earlier ones whatever the array order', () => {
    const doc = clone(fixture('lesson-excerpt.json'));
    doc.tracks[1].items.reverse(); // painting-2 (crossfading in at 412) listed before painting-1 (120)
    const panel = visualLayers(doc).filter((l) => l.track.id === 'panel').map((l) => l.item.id);
    assert.deepEqual(panel, ['painting-1', 'painting-2']);
    assert.deepEqual([...new Set(visualLayers(doc).map((l) => l.track.id))], ['background', 'panel', 'guide', 'verses']);
  });

  it('skips hidden tracks and audio items', () => {
    const doc = clone(fixture('lesson-excerpt.json'));
    doc.tracks[2].hidden = true;
    assert.ok(!visualLayers(doc).some((l) => l.track.id === 'guide'));
    assert.ok(!visualLayers(doc).some((l) => l.track.type === 'audio'));
  });
});
