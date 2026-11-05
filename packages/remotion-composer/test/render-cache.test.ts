import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {link, mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cachedVideo, missRuns, planAudio, planVideo, sha256Cached, VideoCache, type VideoPlan, type VideoSegment} from '../src/render-cache.js';
import {sha256} from '../src/assets.js';
import type {KitVersion} from '../src/kits/types.js';
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

  it('keys a kit item by what its kit says a segment reads, and that alone', () => {
    // A kit spanning the whole video whose props hold one part per second, each drawn in its own second only.
    const ranges: {from: number; to: number}[] = [];
    const kit = {
      name: 'parts', version: '1.0.0',
      segmentProps: (props: Record<string, unknown>, range: {from: number; to: number; fps: number}) => {
        ranges.push({from: range.from, to: range.to});
        const parts = props.parts as unknown[];
        return {title: props.title, parts: parts.slice(Math.floor(range.from / range.fps), Math.floor(range.to / range.fps) + 1)};
      },
    } as unknown as KitVersion;
    const doc = cacheTimeline();
    doc.tracks = [{id: 'main', type: 'visual', z: 0, items: [
      {id: 'p', from: 15, duration: 60, kit: {name: 'parts', version: '1.0.0'}, props: {title: 'T', parts: ['zero', {$asset: 'a'}, {$asset: 'b'}]}},
    ]}];
    const keyed = () => planVideo(doc, 'r', {}, [kit]).segments.map((s) => s.key);
    const before = keyed();
    assert.deepEqual(ranges.splice(0), [{from: 0, to: 14}, {from: 15, to: 44}, {from: 45, to: 59}], 'ranges in the item\'s frames');
    const item = doc.tracks[0]!.items[0] as VisualItem;
    (item.props.parts as unknown[])[0] = 'changed';
    assert.deepEqual(changed(before, keyed()), [0, 1], 'a part re-renders only the segments that read it');
    (item.props.parts as unknown[])[0] = 'zero';
    doc.assets.b!.hash = `sha256:${'e'.repeat(64)}`;
    assert.deepEqual(changed(before, keyed()), [], 'an asset no segment reads keys none');
    doc.assets.a!.hash = `sha256:${'d'.repeat(64)}`;
    assert.deepEqual(changed(before, keyed()), [1, 2], 'an asset keys the segments that read it');
    item.props.title = 'U';
    assert.deepEqual(changed(before, keyed()), [0, 1, 2]);
    assert.notDeepEqual(planVideo(doc, 'r').segments.map((s) => s.key), keyed(), 'without the kit, the whole props key the item');
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
    assert.equal(await cache.has('key'), true);
    assert.equal(await cache.has('other'), false);
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

  it('a file is hashed once while it stays as it is, by any of its names', async () => workspace(async (root) => {
    const file = path.join(root, 'picture');
    await writeFile(file, 'first');
    assert.equal(await sha256Cached(file), await sha256(file));
    const linked = path.join(root, 'linked');
    await link(file, linked);
    assert.equal(await sha256Cached(linked), await sha256(file));
    // Rewritten, it is read again: another time, another size.
    await writeFile(file, 'the second picture');
    assert.equal(await sha256Cached(file), await sha256(file));
    await writeFile(file, 'third');
    await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    assert.equal(await sha256Cached(file), await sha256(file));
  }));

  it('a cached entry changed in place is a miss, never a stale hit', async () => workspace(async (root) => {
    const cache = new VideoCache(path.join(root, 'cache'), []);
    const source = path.join(root, 'source');
    await writeFile(source, 'segment A');
    await cache.put('key', source);
    assert.equal(await cache.get('key', path.join(root, 'dest')), true);
    await writeFile(path.join(root, 'cache', 'key.mp4'), 'segment B');
    assert.equal(await cache.get('key', path.join(root, 'dest')), false);
  }));

  it('with deferStore the video is returned at once and cached whole when `stored` settles', async () => workspace(async (root) => {
    const plan = planVideo(cacheTimeline(), 'r');
    const cacheDir = path.join(root, 'cache');
    const options = {plan, cacheDir, renderRun: each(async (_segment, output) => { await writeFile(output, 'video'); }),
      concatenate: async (_files: string[], output: string) => { await writeFile(output, 'joined'); }};
    const first = await cachedVideo({...options, work: await mkdtemp(path.join(root, 'work-')), deferStore: true});
    assert.ok(first.stored);
    await first.stored;
    const second = await cachedVideo({...options, work: await mkdtemp(path.join(root, 'work-'))});
    assert.equal(second.report.wholeVideoReused, true);
    assert.equal(second.stored, undefined);
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

  it('shares the misses among lanes that render at once, each run on its lane', async () => workspace(async (root) => {
    const plan = planVideo(cacheTimeline(), 'r');
    const calls: {from: number[]; lane: number}[] = [];
    let busy = 0, most = 0;
    const result = await cachedVideo({
      plan, cacheDir: path.join(root, 'cache'), work: await mkdtemp(path.join(root, 'work-')), lanes: 2,
      renderRun: async (segments, outputs, _onProgress, lane) => {
        calls.push({from: segments.map((s) => s.from), lane});
        most = Math.max(most, ++busy);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await each(async (s, o) => writeFile(o, s.key))(segments, outputs);
        busy--;
      },
      concatenate: async (files, output) => { await writeFile(output, (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('|')); },
    });
    assert.deepEqual(calls, [{from: [0, 30], lane: 0}, {from: [60], lane: 1}], 'three misses on two lanes: runs of two');
    assert.equal(most, 2, 'the lanes render at once');
    assert.equal(result.report.segmentsRendered, 3);
    assert.equal(await readFile(result.video, 'utf8'), plan.segments.map((s) => s.key).join('|'), 'joined in order whatever lane drew them');
  }));

  it('draws a failed run again once before failing the render', async () => workspace(async (root) => {
    const plan = planVideo(cacheTimeline(), 'r');
    const cacheDir = path.join(root, 'cache');
    let failures = 1;
    const calls: number[][] = [];
    const result = await cachedVideo({
      plan, cacheDir, work: await mkdtemp(path.join(root, 'work-')),
      renderRun: async (segments, outputs) => {
        calls.push(segments.map((s) => s.from));
        // FFmpeg that could not start at the end of a run (Windows 0xC0000142)
        if (failures-- > 0) throw new Error('FFmpeg quit with code 3221225794');
        await each(async (s, o) => writeFile(o, s.key))(segments, outputs);
      },
      concatenate: async (_files, output) => { await writeFile(output, 'joined'); },
    });
    assert.deepEqual(calls, [[0, 30, 60], [0, 30, 60]], 'the same run, drawn again');
    assert.equal(result.report.segmentsRendered, 3);
    assert.match(result.report.warnings.join('\n'), /drawn again after: FFmpeg quit/);
    await assert.rejects(cachedVideo({
      plan: planVideo(cacheTimeline(), 'other'), cacheDir, work: await mkdtemp(path.join(root, 'work-')), retries: 0,
      renderRun: async () => { throw new Error('Chrome failed'); },
      concatenate: async () => {},
    }), /Chrome failed/, 'retries: 0 fails at once');
  }));

  it('runs are half a minute at most by default, so a long render publishes as it goes', async () => workspace(async (root) => {
    const doc = cacheTimeline();
    doc.durationInFrames = 75 * doc.fps;
    for (const track of doc.tracks) for (const item of track.items) item.duration = doc.durationInFrames;
    const calls: number[] = [];
    await cachedVideo({
      plan: planVideo(doc, 'r'), cacheDir: path.join(root, 'cache'), work: await mkdtemp(path.join(root, 'work-')),
      renderRun: async (segments, outputs) => { calls.push(segments.length); await each(async (s, o) => writeFile(o, s.key))(segments, outputs); },
      concatenate: async (_files, output) => { await writeFile(output, 'joined'); },
    });
    assert.deepEqual(calls, [30, 30, 15]);
  }));

  it('a failed lane fails the render, and the other lane publishes what it finished', async () => workspace(async (root) => {
    const plan = planVideo(cacheTimeline(), 'r');
    const cacheDir = path.join(root, 'cache');
    await assert.rejects(cachedVideo({
      plan, cacheDir, work: await mkdtemp(path.join(root, 'work-')), lanes: 3,
      renderRun: async (segments, outputs, _onProgress, lane) => {
        if (lane === 1) throw new Error('Chrome failed');
        await new Promise((resolve) => setTimeout(resolve, 20));
        await each(async (s, o) => writeFile(o, s.key))(segments, outputs);
      },
      concatenate: async () => {},
    }), /Chrome failed/);
    // settled before it fails: nothing is still writing when the caller cleans up
    assert.equal((await readdir(path.join(cacheDir, 'segments'))).filter((f) => f.endsWith('.mp4')).length, 2);
  }));

  it('reports progress inside a run, not only when it ends', async () => workspace(async (root) => {
    const plan = planVideo(cacheTimeline(), 'r');
    const seen: number[] = [];
    await cachedVideo({
      plan, cacheDir: path.join(root, 'cache'), work: await mkdtemp(path.join(root, 'work-')),
      renderRun: async (segments, outputs, onProgress) => {
        onProgress(0.5);
        await each(async (s, o) => writeFile(o, s.key))(segments, outputs);
      },
      concatenate: async (_files, output) => { await writeFile(output, 'joined'); },
      onProgress: (p) => seen.push(p),
    });
    assert.deepEqual(seen, [0, 0.5, 1]);
  }));

  it('a share draws only its segments and joins nothing', async () => workspace(async (root) => {
    const plan = planVideo(cacheTimeline(), 'r');
    const rendered: number[][] = [];
    let concatenations = 0;
    const share = await cachedVideo({
      plan, cacheDir: path.join(root, 'cache'), work: await mkdtemp(path.join(root, 'work-')), only: [2, 1, 2],
      renderRun: async (segments, outputs) => {
        rendered.push(segments.map((s) => s.from));
        await each(async (s, o) => writeFile(o, s.key))(segments, outputs);
      },
      concatenate: async () => { concatenations++; },
    });
    assert.deepEqual(rendered, [[30, 60]]);
    assert.equal(share.video, '');
    assert.equal(concatenations, 0);
    assert.equal(await readFile(share.files[1]!, 'utf8'), plan.segments[1]!.key);
    await assert.rejects(cachedVideo({plan, cacheDir: path.join(root, 'cache'), work: root, only: [3],
      renderRun: async () => {}, concatenate: async () => {}}), /no segment 3/);
  }));

  it('the assembly takes the segments drawn elsewhere, checks them, and caches them with the whole video', async () => workspace(async (root) => {
    const plan = planVideo(cacheTimeline(), 'r');
    const cacheDir = path.join(root, 'cache');
    const elsewhere = path.join(root, 'elsewhere-1.mp4');
    await writeFile(elsewhere, 'from casa');
    const rendered: number[] = [];
    const checked: number[][] = [];
    const result = await cachedVideo({
      plan, cacheDir, work: await mkdtemp(path.join(root, 'work-')), provided: new Map([[1, elsewhere]]),
      renderRun: async (segments, outputs) => {
        rendered.push(...segments.map((s) => s.from));
        await each(async (s, o) => writeFile(o, s.key))(segments, outputs);
      },
      checkProvided: async (_files, provided) => { checked.push(provided); },
      concatenate: async (files, output) => { await writeFile(output, (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('|')); },
    });
    assert.deepEqual(rendered, [0, 60]);
    assert.deepEqual(checked, [[1]]);
    assert.equal(result.report.segmentsProvided, 1);
    assert.equal((await readFile(result.video, 'utf8')).split('|')[1], 'from casa');
    const segments = new VideoCache(path.join(cacheDir, 'segments'), []);
    assert.equal(await segments.has(plan.segments[1]!.key), true, 'a correction draws it no more');
    assert.equal(await new VideoCache(path.join(cacheDir, 'video'), []).has(plan.key), true);
    const copy = path.join(root, 'copy.mp4');
    assert.equal(await segments.get(plan.segments[1]!.key, copy), true);
    assert.equal(await readFile(copy, 'utf8'), 'from casa');
    await assert.rejects(cachedVideo({
      plan, cacheDir: path.join(root, 'cache-2'), work: await mkdtemp(path.join(root, 'work-')), provided: new Map([[1, elsewhere]]),
      renderRun: async () => {}, concatenate: async () => {},
      checkProvided: async () => { throw new Error('not encoded like this machine'); },
    }), /not encoded like this machine/);
  }));
});

describe('audio key', () => {
  it('changes with the sound, not with the pictures', () => {
    const doc = cacheTimeline();
    const key = planAudio(doc, 'r', 48000);
    (doc.tracks[1]!.items[0] as VisualItem).props.text = 'Changed';
    assert.equal(planAudio(doc, 'r', 48000), key, 'a caption edit keeps the soundtrack');
    doc.assets.voice = {...doc.assets.voice!, hash: `sha256:${'d'.repeat(64)}`};
    assert.notEqual(planAudio(doc, 'r', 48000), key, 'new voice media is a new soundtrack');
    assert.notEqual(planAudio(cacheTimeline(), 'other renderer', 48000), key);
  });

  it('holds the items of kits that play sound, and only those', () => {
    const doc = cacheTimeline();
    const plain = planAudio(doc, 'r', 48000);
    const item = doc.tracks[1]!.items[0] as VisualItem;
    assert.equal(planAudio(doc, 'r', 48000, new Set()), plain, 'no sounding kit: the key of the audio tracks alone');
    const sounding = planAudio(doc, 'r', 48000, new Set([item]));
    assert.notEqual(sounding, plain, 'a kit that plays sound is part of the soundtrack');
    item.props.text = 'Changed';
    assert.notEqual(planAudio(doc, 'r', 48000, new Set([item])), sounding, 'its props change its sound');
    assert.equal(planAudio(doc, 'r', 48000), plain, 'other kits never enter the key');
  });
});

describe('sound kit context in audio keys', () => {
  it('invalidates on profile changes only when a kit can play sound', () => {
    const doc = cacheTimeline();
    const sounding = new Set([doc.tracks[1]!.items[0]]);
    const plain = planAudio(doc, 'r', 48000);
    const before = planAudio(doc, 'r', 48000, sounding);
    doc.profile.safeZone.bottom++;
    assert.notEqual(planAudio(doc, 'r', 48000, sounding), before, 'kits receive the whole context.profile');
    assert.equal(planAudio(doc, 'r', 48000), plain, 'audio tracks do not read the picture profile');
  });

  it('invalidates on asset frame counts only when a kit can play sound', () => {
    const doc = cacheTimeline();
    const sounding = new Set([doc.tracks[1]!.items[0]]);
    assert.notEqual(planAudio(doc, 'r', 48000, sounding, {clip: 10}), planAudio(doc, 'r', 48000, sounding, {clip: 11}));
    assert.equal(planAudio(doc, 'r', 48000, new Set(), {clip: 10}), planAudio(doc, 'r', 48000, new Set(), {clip: 11}));
  });
});

describe('miss runs', () => {
  it('groups consecutive indexes, splits gaps and caps length', () => {
    assert.deepEqual(missRuns([], 4), []);
    assert.deepEqual(missRuns([0, 1, 2, 5, 6, 9], 4), [[0, 1, 2], [5, 6], [9]]);
    assert.deepEqual(missRuns([0, 1, 2, 3, 4], 2), [[0, 1], [2, 3], [4]]);
  });
});
