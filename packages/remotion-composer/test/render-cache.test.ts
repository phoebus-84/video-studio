import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cachedVideo, missRuns, planVideo, VideoCache, type VideoPlan, type VideoSegment} from '../src/render-cache.js';
import type {EditTimeline, VisualItem} from '../src/schema.js';

import {cacheTimeline} from './cache-fixture.js';

const keys = (doc: EditTimeline, renderer = 'renderer-v1') => planVideo(doc, renderer).segments.map((s) => s.key);
const changed = (a: string[], b: string[]) => a.flatMap((key, i) => key !== b[i] ? [i] : []);
/** A run renderer that writes each segment with `write`, one after another. */
const each = (write: (segment: VideoSegment, output: string) => Promise<void>) =>
  async (segments: VideoSegment[], outputs: string[]) => { for (const [i, segment] of segments.entries()) await write(segment, outputs[i]!); };

describe('video cache plan', () => {
  it('uses original inclusive one-second ranges, including a short tail', () => {
    assert.deepEqual(planVideo(cacheTimeline(), 'r').segments.map(({from, to}) => [from, to]), [[0, 29], [30, 59], [60, 74]]);
  });

  it('ignores narration bytes, timing, gain, ducking, mute and editorial metadata', () => {
    const doc = cacheTimeline();
    const before = planVideo(doc, 'r');
    doc.assets.voice!.hash = `sha256:${'d'.repeat(64)}`;
    doc.tracks[2]!.items[0]!.duration = 60;
    doc.tracks[2]!.muted = true;
    doc.tracks[2]!.duck = {under: ['other'], gain: 0.3};
    doc.revision++;
    doc.metadata = {inputs: {changed: true}};
    doc.episodeRef.episode = 'another';
    doc.sections = [{id: 'chapter', from: 0, duration: 75, chapter: {title: 'New'}}];
    assert.deepEqual(planVideo(doc, 'r'), before);
    doc.tracks.pop();
    delete doc.assets.voice;
    assert.deepEqual(planVideo(doc, 'r'), before, 'removing audio must also reuse video');
  });

  it('invalidates both sides of a crossfade, but not unrelated segments', () => {
    const doc = cacheTimeline();
    const before = keys(doc);
    doc.assets.a!.hash = `sha256:${'d'.repeat(64)}`;
    assert.deepEqual(changed(before, keys(doc)), [0, 1]);
    doc.assets.b!.hash = `sha256:${'e'.repeat(64)}`;
    assert.deepEqual(changed(before, keys(doc)), [0, 1, 2]);
  });

  it('invalidates local captions, kit props, versions, transitions and drawing order', () => {
    for (const mutate of [
      (item: VisualItem) => { item.props.text = 'Changed'; },
      (item: VisualItem) => { item.kit.version = '1.2.0'; },
      (item: VisualItem) => { item.transitionIn = {type: 'fade', duration: 3}; },
    ]) {
      const doc = cacheTimeline();
      const before = keys(doc);
      mutate(doc.tracks[1]!.items[0] as VisualItem);
      assert.deepEqual(changed(before, keys(doc)), [1]);
    }
    const doc = cacheTimeline();
    const before = keys(doc);
    doc.tracks[1]!.z = -1;
    assert.deepEqual(changed(before, keys(doc)), [1]);
    doc.tracks[1]!.hidden = true;
    assert.deepEqual(changed(before, keys(doc)), [1]);
  });

  it('invalidates global changes and runtime/encoder changes conservatively', () => {
    for (const mutate of [
      (doc: EditTimeline) => { doc.profile.safeZone.bottom++; },
      (doc: EditTimeline) => { doc.durationInFrames++; },
      (doc: EditTimeline) => { doc.fps = 25; },
      (doc: EditTimeline) => { doc.resolution.width += 2; doc.profile.width += 2; },
    ]) {
      const doc = cacheTimeline();
      const before = keys(doc);
      mutate(doc);
      assert.deepEqual(changed(before, keys(doc)), [0, 1, 2]);
    }
    const doc = cacheTimeline();
    assert.deepEqual(changed(keys(doc), keys(doc, 'renderer-v2')), [0, 1, 2]);
    assert.notEqual(planVideo(doc, 'r', {clip: 10}).key, planVideo(doc, 'r', {clip: 11}).key);
  });

  it('includes nested asset references and ignores JSON key ordering', () => {
    const doc = cacheTimeline();
    const item = doc.tracks[1]!.items[0] as VisualItem;
    item.props = {nested: [{src: {$asset: 'voice'}}], text: 'Hello'};
    const before = keys(doc);
    item.props = {text: 'Hello', nested: [{src: {$asset: 'voice'}}]};
    assert.deepEqual(keys(doc), before);
    doc.assets.voice!.hash = `sha256:${'f'.repeat(64)}`;
    assert.deepEqual(changed(before, keys(doc)), [1], 'audio-kind assets used visually must invalidate video');
  });
});

describe('video cache storage and execution', () => {
  async function workspace(fn: (root: string) => Promise<void>) {
    const root = await mkdtemp(path.join(tmpdir(), 'video-cache-test-'));
    try { await fn(root); } finally { await rm(root, {recursive: true, force: true}); }
  }

  it('renders cold, reuses the whole video, and only re-renders affected segments', async () => workspace(async (root) => {
    const doc = cacheTimeline();
    const cacheDir = path.join(root, 'cache');
    const rendered: number[][] = [];
    let concatenations = 0;
    const run = async (plan: VideoPlan) => {
      const work = await mkdtemp(path.join(root, 'work-'));
      return cachedVideo({plan, cacheDir, work,
        renderRun: async (segments, outputs) => {
          rendered.push(segments.map((segment) => segment.from));
          await each(async (segment, output) => { await writeFile(output, segment.key); })(segments, outputs);
        },
        concatenate: async (files, output) => { concatenations++; await writeFile(output, (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('')); },
      });
    };
    const first = await run(planVideo(doc, 'r'));
    assert.equal(first.report.segmentsRendered, 3);
    assert.deepEqual(rendered, [[0, 30, 60]], 'a cold render is one renderer call, not one per second');
    rendered.length = 0;
    const second = await run(planVideo(doc, 'r'));
    assert.equal(second.report.wholeVideoReused, true);
    assert.equal(concatenations, 1);
    assert.deepEqual(rendered, []);
    doc.assets.a!.hash = `sha256:${'d'.repeat(64)}`;
    const third = await run(planVideo(doc, 'r'));
    assert.deepEqual(rendered, [[0, 30]]);
    assert.equal(third.report.segmentsReused, 1);
    assert.equal(third.report.segmentsRendered, 2);
    assert.notEqual(await readFile(first.video, 'utf8'), await readFile(third.video, 'utf8'));
  }));

  it('corrupt or interrupted entries are misses; concurrent writers publish complete data', async () => workspace(async (root) => {
    const warnings: string[] = [];
    const cache = new VideoCache(path.join(root, 'cache'), warnings);
    const source = path.join(root, 'source');
    const dest = path.join(root, 'dest');
    await writeFile(source, 'complete video');
    await Promise.all([cache.put('key', source), cache.put('key', source)]);
    assert.equal(await cache.get('key', dest), true);
    assert.deepEqual((await readdir(path.join(root, 'cache'))).sort(), ['key.json', 'key.mp4']);
    await writeFile(path.join(root, 'cache/key.mp4'), 'truncated');
    assert.equal(await cache.get('key', dest), false);
    await cache.put('key', source);
    assert.equal(await cache.get('key', dest), true);
    await writeFile(path.join(root, 'cache/key.json'), '{');
    assert.equal(await cache.get('key', dest), false);
    await rm(path.join(root, 'cache/key.json'));
    assert.equal(await cache.get('key', dest), false);
  }));

  it('a failed segment is not published; completed segments can resume', async () => workspace(async (root) => {
    const plan = planVideo(cacheTimeline(), 'r');
    const cacheDir = path.join(root, 'cache');
    const work = path.join(root, 'work');
    await mkdir(work);
    let fail = true;
    const renderRun = each(async (segment, output) => {
      await writeFile(output, 'video');
      if (fail && segment.from === 30) throw new Error('Chrome failed');
    });
    const concatenate = async (_files: string[], output: string) => { await writeFile(output, 'joined'); };
    await assert.rejects(cachedVideo({plan, cacheDir, work, renderRun, concatenate, maxRunSegments: 1}), /Chrome failed/);
    assert.equal((await readdir(path.join(cacheDir, 'segments'))).length, 2);
    fail = false;
    const resumed = await cachedVideo({plan, cacheDir, work, renderRun, concatenate});
    assert.equal(resumed.report.segmentsReused, 1);
    assert.equal(resumed.report.segmentsRendered, 2);
  }));

  it('unwritable cache is best effort and does not lose the render', async () => workspace(async (root) => {
    const cacheDir = path.join(root, 'not-a-directory');
    await writeFile(cacheDir, 'file');
    const result = await cachedVideo({plan: planVideo(cacheTimeline(), 'r'), cacheDir, work: root,
      renderRun: each(async (_segment, output) => { await writeFile(output, 'video'); }),
      concatenate: async (_files, output) => { await writeFile(output, 'joined'); },
    });
    assert.equal(result.report.segmentsRendered, 3);
    assert.ok(result.report.warnings.length > 0);
    assert.equal(await readFile(result.video, 'utf8'), 'joined');
  }));

  it('a failed run publishes none of its segments', async () => workspace(async (root) => {
    const plan = planVideo(cacheTimeline(), 'r');
    const cacheDir = path.join(root, 'cache');
    const work = path.join(root, 'work');
    await mkdir(work);
    const renderRun = each(async (segment, output) => {
      await writeFile(output, 'video');
      if (segment.from === 30) throw new Error('Chrome failed');
    });
    await assert.rejects(cachedVideo({plan, cacheDir, work, renderRun, concatenate: async () => {}}), /Chrome failed/);
    assert.deepEqual(await readdir(cacheDir).catch(() => []), [], 'the first segment was written but its run never finished');
  }));

  it('renders only the misses, grouped in consecutive runs', async () => workspace(async (root) => {
    const doc = cacheTimeline();
    const cacheDir = path.join(root, 'cache');
    const calls: number[][] = [];
    const run = (plan: VideoPlan, maxRunSegments?: number) => mkdtemp(path.join(root, 'work-')).then((work) => cachedVideo({
      plan, cacheDir, work, ...(maxRunSegments ? {maxRunSegments} : {}),
      renderRun: async (segments, outputs) => { calls.push(segments.map((s) => s.from)); await each(async (s, o) => writeFile(o, s.key))(segments, outputs); },
      concatenate: async (_files, output) => { await writeFile(output, 'joined'); },
    }));
    await run(planVideo(doc, 'r'), 2);
    assert.deepEqual(calls, [[0, 30], [60]], 'runs are capped');
    calls.length = 0;
    (doc.tracks[1]!.items[0] as VisualItem).props.text = 'Changed';
    await run(planVideo(doc, 'r'));
    assert.deepEqual(calls, [[30]], 'the untouched seconds around it are reused');
  }));
});

describe('miss runs', () => {
  it('groups consecutive indexes, splits gaps and caps length', () => {
    assert.deepEqual(missRuns([], 4), []);
    assert.deepEqual(missRuns([0, 1, 2, 5, 6, 9], 4), [[0, 1, 2], [5, 6], [9]]);
    assert.deepEqual(missRuns([0, 1, 2, 3, 4], 2), [[0, 1], [2, 3], [4]]);
  });
});
