// Opt-in real renders. Besides hit counts, check decoded boundary frames,
// video packet identity on audio-only edits, frame count and final loudness.
import {it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFile, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from '../src/assets.js';
import type {AudioItem, VisualItem} from '../src/schema.js';
import {cacheTimeline} from './cache-fixture.js';

const enabled = process.env.REMOTION_E2E === '1';
function ffmpeg(args: string[]): Buffer {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {maxBuffer: 32 * 1024 * 1024});
  assert.equal(r.status, 0, r.stderr.toString());
  return r.stdout;
}
const videoBytes = (file: string) => ffmpeg(['-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'h264', '-']);
const pixels = (file: string) => ffmpeg(['-i', file, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const FRAME = 320 * 180 * 3;
// Same frames, within lossy-encoding noise. A segment cut from a run of
// segments is encoded with its neighbours in x264's lookahead, so it is not
// byte-identical to the same segment encoded alone, nor to an uncached render;
// timing or composition mistakes are far above this bound. Reported per frame:
// deepEqual on two 13 MB buffers runs out of memory building its diff.
function assertFramesClose(actual: Buffer, reference: Buffer, label: string) {
  assert.equal(actual.length, reference.length, `${label}: frame count`);
  for (let frame = 0; frame < actual.length / FRAME; frame++) {
    let error = 0;
    for (let i = frame * FRAME; i < (frame + 1) * FRAME; i++) error += Math.abs(actual[i]! - reference[i]!);
    assert.ok(error / FRAME < 3, `${label}: frame ${frame} mean pixel error ${error / FRAME}`);
  }
}

it('real cache: crossfade/clip/captions, audio-only reuse, partial rebuild, corruption and asset checks', {skip: !enabled && 'set REMOTION_E2E=1', timeout: 300_000}, async () => {
  const {renderTimeline} = await import('../dist/index.js');
  const root = await mkdtemp(path.join(tmpdir(), 'composer-cache-e2e-'));
  try {
    const cacheDir = path.join(root, 'cache');
    const timeline = cacheTimeline();
    ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=320x180', '-frames:v', '1', path.join(root, 'a.png')]);
    await copyFile(fileURLToPath(new URL('../kits/samples/sample.mp4', import.meta.url)), path.join(root, 'b.mp4'));
    timeline.assets.b!.path = 'b.mp4';
    timeline.assets.b!.kind = 'video';
    (timeline.tracks[0]!.items[1] as VisualItem).kit = {name: 'clip', version: '1.0.0'};
    const tone = (frequency: number) => ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=2.5`, '-ar', '48000', path.join(root, 'voice.wav')]);
    tone(440);
    for (const asset of Object.values(timeline.assets)) asset.hash = await sha256(path.join(root, asset.path));
    let n = 0;
    const render = (cache: string | undefined = cacheDir) => renderTimeline({timeline, assetRoot: root, cacheDir: cache, outputPath: path.join(root, `out-${n++}.mp4`), concurrency: 2});
    const cold = await render();
    assert.equal(cold.cache!.segmentsRendered, 3);
    assert.equal(cold.cache!.wholeVideoReused, false);
    assert.deepEqual(cold.cache!.warnings, []);
    const decoded = pixels(cold.path);
    assert.equal(decoded.length, 75 * 320 * 180 * 3, 'no missing/duplicated frames at concat seams or short tail');
    const voiceBefore = ffmpeg(['-i', cold.path, '-map', '0:a:0', '-f', 's16le', '-']);

    tone(660);
    timeline.assets.voice!.hash = await sha256(path.join(root, 'voice.wav'));
    const voice = timeline.tracks[2]!.items[0] as AudioItem;
    voice.gain = 0.5;
    voice.fadeIn = 10;
    voice.fadeOut = 10;
    const audioOnly = await render();
    assert.equal(audioOnly.cache!.wholeVideoReused, true);
    assert.equal(audioOnly.cache!.segmentsRendered, 0);
    assert.deepEqual(videoBytes(audioOnly.path), videoBytes(cold.path), 'audio edit must copy the exact encoded video');
    assert.notDeepEqual(ffmpeg(['-i', audioOnly.path, '-map', '0:a:0', '-f', 's16le', '-']), voiceBefore);
    const measured = spawnSync('ffmpeg', ['-hide_banner', '-i', audioOnly.path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], {encoding: 'utf8'}).stderr;
    const loudness = JSON.parse(measured.slice(measured.lastIndexOf('{'), measured.lastIndexOf('}') + 1));
    assert.ok(Math.abs(Number(loudness.input_i) + 15) <= 1, loudness.input_i);
    assert.ok(Number(loudness.input_tp) <= -1, loudness.input_tp);

    // The caption exists only in second 1; the clip keeps its local clock and freezes at its end.
    (timeline.tracks[1]!.items[0] as VisualItem).props.text = 'Bye';
    const partial = await render();
    assert.equal(partial.cache!.segmentsReused, 2);
    assert.equal(partial.cache!.segmentsRendered, 1);
    const fresh = await render(path.join(root, 'fresh-cache'));
    const actual = pixels(partial.path);
    assertFramesClose(actual, pixels(fresh.path), 'partial rebuild vs a clean segmented render');
    // Compare all frames against the uncached renderer. Separate GOPs can
    // change lossy compression, but not animation timing or composition.
    const uncached = await renderTimeline({timeline, assetRoot: root, outputPath: path.join(root, 'uncached.mp4'), concurrency: 2});
    assertFramesClose(actual, pixels(uncached.path), 'partial rebuild vs the uncached renderer');

    // Removing the whole cache exercises segment recovery, including a damaged segment.
    await rm(path.join(cacheDir, 'video'), {recursive: true});
    const segments = (await readdir(path.join(cacheDir, 'segments'))).filter((f) => f.endsWith('.mp4'));
    for (const file of segments) await writeFile(path.join(cacheDir, 'segments', file), 'truncated');
    const recovered = await render();
    assert.equal(recovered.cache!.segmentsRendered, 3);
    assertFramesClose(pixels(recovered.path), actual, 'recovered cache vs partial rebuild');

    // Removing narration switches to silent delivery without re-encoding video.
    timeline.tracks = timeline.tracks.filter((t) => t.type === 'visual');
    delete timeline.assets.voice;
    const silent = await render();
    assert.equal(silent.cache!.wholeVideoReused, true);
    assert.equal(silent.loudness, null);
    assert.deepEqual(videoBytes(silent.path), videoBytes(recovered.path));

    // A whole-video hit must never bypass source verification.
    await writeFile(path.join(root, 'a.png'), 'changed without updating the timeline hash');
    await assert.rejects(render(), (e: any) => e.code === 'hash-mismatch');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

it('cached silent video preserves an audio track and the final short segment', {skip: !enabled && 'set REMOTION_E2E=1', timeout: 120_000}, async () => {
  const {renderTimeline} = await import('../dist/index.js');
  const root = await mkdtemp(path.join(tmpdir(), 'composer-cache-silent-'));
  try {
    const timeline = cacheTimeline();
    timeline.tracks = [{id: 'empty', type: 'visual', items: []}];
    timeline.assets = {};
    const options = {timeline, assetRoot: root, cacheDir: path.join(root, 'cache')};
    const cold = await renderTimeline({...options, outputPath: path.join(root, 'cold.mp4')});
    const warm = await renderTimeline({...options, outputPath: path.join(root, 'warm.mp4')});
    assert.equal(warm.cache!.wholeVideoReused, true);
    assert.equal(warm.loudness, null);
    assert.deepEqual(videoBytes(cold.path), videoBytes(warm.path));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', warm.path], {encoding: 'utf8'});
    const streams = JSON.parse(probe.stdout).streams;
    assert.equal(Number(streams.find((s: any) => s.codec_type === 'video').nb_frames), 75);
    assert.ok(streams.some((s: any) => s.codec_type === 'audio'));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
