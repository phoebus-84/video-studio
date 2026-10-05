import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {duckWeight, itemVolume} from '../src/volume.js';
import type {EditTimeline} from '../src/schema.js';

const timeline = (music: Record<string, unknown>, voice: {from: number; duration: number}[]): EditTimeline => ({
  apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline',
  episodeRef: {channel: 'c', series: 's', episode: 'e'}, revision: 1, fps: 30, durationInFrames: 300,
  resolution: {width: 1920, height: 1080}, assets: {},
  tracks: [
    {id: 'voice', type: 'audio', items: voice.map((v, i) => ({id: `v${i}`, asset: 'take', ...v}))},
    {id: 'music', type: 'audio', ...music, items: [{id: 'm', from: 0, duration: 300, asset: 'music', gain: 0.5}]},
  ],
}) as EditTimeline;

const musicVolume = (t: EditTimeline) => itemVolume(t.tracks[1]!.items[0] as never, t.tracks[1]!, t);

describe('itemVolume', () => {
  it('applies gain, fade-in and fade-out', () => {
    const t = timeline({}, []);
    const item = {id: 'x', from: 10, duration: 100, asset: 'a', gain: 0.8, fadeIn: 10, fadeOut: 20};
    const v = itemVolume(item, {id: 'fx', type: 'audio', items: [item]}, t);
    assert.equal(v(0), 0);
    assert.equal(v(5), 0.4);
    assert.equal(v(50), 0.8);
    assert.equal(v(90), 0.4);
    assert.equal(v(100), 0);
    assert.equal(v(-1), 0);
  });

  it('leaves a track without duck alone', () => {
    assert.equal(musicVolume(timeline({}, [{from: 50, duration: 50}]))(60), 0.5);
  });

  it('ducks under the voice, with attack and release ramps', () => {
    const v = musicVolume(timeline({duck: {under: ['voice'], gain: 0.4, attack: 10, release: 20}}, [{from: 100, duration: 50}]));
    assert.equal(v(50), 0.5); // far from the voice
    assert.equal(v(95), 0.5 * (1 - 0.6 * 0.5)); // halfway through the attack
    assert.equal(v(120), 0.5 * 0.4); // under the voice
    assert.equal(v(160), 0.5 * (1 - 0.6 * 0.5)); // halfway through the release
    assert.equal(v(200), 0.5);
  });
});

describe('duckWeight', () => {
  it('takes the strongest of overlapping spans and has no ramp when attack is zero', () => {
    const spans = [{from: 10, duration: 5}, {from: 12, duration: 10}];
    assert.equal(duckWeight(9, spans, 0, 0), 0);
    assert.equal(duckWeight(20, spans, 0, 0), 1);
    assert.equal(duckWeight(22, spans, 0, 4), 1);
    assert.equal(duckWeight(24, spans, 0, 4), 0.5);
  });
});
