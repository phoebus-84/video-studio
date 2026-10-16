import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {soundFrames, type PlacedSound} from '../src/sound-mix.js';

const at = (frames: ReturnType<typeof soundFrames>, frame: number) => frames[frame]!.map(({mediaFrame, volume, audioStartFrame}) => ({mediaFrame, volume, audioStartFrame}));
const ids = (frames: ReturnType<typeof soundFrames>) => new Set(frames.flat().map((a) => a.id));
const one = (sound: Partial<PlacedSound>, total = 100, seconds = 1) =>
  soundFrames([{file: 'a.wav', sequences: [{from: 10, durationInFrames: 50}], ...sound}], total, 30, () => seconds);

describe('soundFrames', () => {
  it('sounds inside its sequences only, from the media start', () => {
    const frames = one({sequences: [{from: 10, durationInFrames: 50}, {from: 5, durationInFrames: 20}]});
    assert.deepEqual(frames.map((f, i) => (f.length ? i : -1)).filter((i) => i >= 0), Array.from({length: 20}, (_, i) => 15 + i));
    assert.deepEqual(at(frames, 15), [{mediaFrame: 0, volume: 1, audioStartFrame: 0}]);
    assert.deepEqual(at(frames, 34), [{mediaFrame: 19, volume: 1, audioStartFrame: 0}]);
  });

  it('cuts a nested sequence at its parent\'s end', () => {
    const frames = one({sequences: [{from: 10, durationInFrames: 20}, {from: 5, durationInFrames: 100}]});
    assert.equal(frames.findLastIndex((f) => f.length > 0), 29);
  });

  it('skips trimBefore frames of the media, and passes the volume the frame from the sequence start', () => {
    const frames = one({trimBefore: 45, volume: (f) => f / 100});
    assert.deepEqual(at(frames, 10), []);
    assert.deepEqual(at(frames, 11), [{mediaFrame: 46, volume: 0.01, audioStartFrame: 45}]);
  });

  it('registers nothing on a silent frame', () => {
    const frames = one({volume: (f) => (f < 5 ? 0 : 0.5)});
    assert.equal(frames.findIndex((f) => f.length > 0), 15);
  });

  it('restarts a looping sound at the file\'s end, each round its own asset, its volume frame restarting', () => {
    const frames = one({loop: true, volume: (f) => f}, 100, 0.5);
    assert.deepEqual(at(frames, 24), [{mediaFrame: 14, volume: 14, audioStartFrame: 0}]);
    assert.deepEqual(at(frames, 25), [], 'the second round starts at volume frame 0: silent');
    assert.deepEqual(at(frames, 26), [{mediaFrame: 1, volume: 1, audioStartFrame: 0}]);
    assert.equal(ids(frames).size, 4);
  });

  it('keeps one of two identical sounds in a frame, as Remotion deduplicates by id', () => {
    const sound: PlacedSound = {file: 'a.wav', sequences: [{from: 0, durationInFrames: 10}], volume: 0.5};
    const frames = soundFrames([sound, {...sound, volume: 0.9}], 20, 30, () => 1);
    assert.deepEqual(at(frames, 3), [{mediaFrame: 3, volume: 0.5, audioStartFrame: 0}]);
  });
});
