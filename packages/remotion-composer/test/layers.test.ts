import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {soundLayers, visualLayers} from '../src/layers.js';
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

describe('soundLayers', () => {
  it('keeps the visual items whose kit plays sound, in drawing order', () => {
    const doc = clone(fixture('lesson-excerpt.json'));
    const layers = visualLayers(doc);
    const loud = layers[1]!.item.kit;
    const sound = soundLayers(doc, (name, version) => (name === loud.name && version === loud.version ? {sound: true} : {}));
    assert.ok(sound.length > 0);
    assert.ok(sound.every(({item}) => item.kit.name === loud.name && item.kit.version === loud.version));
    assert.deepEqual(sound.map((l) => l.item.id), layers.filter((l) => l.item.kit.name === loud.name && l.item.kit.version === loud.version).map((l) => l.item.id));
    assert.deepEqual(soundLayers(doc, () => undefined), []);
  });
});
