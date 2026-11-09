import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstTimeline } from '../first-render.mjs';

test('first-render is a valid six-second, asset-free timeline', async () => {
  const { validateTimeline, auditExpectation } = await import('@av/remotion-composer');
  const timeline = firstTimeline();
  assert.deepEqual(validateTimeline(timeline).ok, true);
  assert.equal(timeline.durationInFrames / timeline.fps, 6);
  assert.equal(Object.keys(timeline.assets).length, 0);
  assert.equal(timeline.tracks.length, 1);
  const items = timeline.tracks[0].items;
  assert.deepEqual(items.map(item => [item.from, item.duration]), [[0,48],[48,48],[96,48]]);
  assert.ok(auditExpectation(timeline));
  const second = firstTimeline();
  second.tracks[0].items[0].props.text = 'Changed';
  assert.equal(timeline.tracks[0].items[0].props.text, 'An idea.');
});
