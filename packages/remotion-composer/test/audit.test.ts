// The render audit (avg-3th.3) on real files made with FFmpeg's test sources:
// what it accepts, and the finding each fault gives.
import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {auditExpectation, auditRender, type AuditExpectation} from '../src/audit.js';
import {EditTimelineSchema} from '../src/schema.js';

let dir: string;
before(() => (dir = mkdtempSync(path.join(tmpdir(), 'audit-'))));
after(() => rmSync(dir, {recursive: true, force: true}));

/** A 2 s file at 30 fps: `video` is an lavfi source, `audio` one too (or none). */
function make(name: string, {video = 'testsrc2=size=320x180:rate=30', audio = 'sine=frequency=440:sample_rate=48000' as string | null, seconds = 2, codec = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], audioCodec = ['-c:a', 'aac'], volume = '0.3'} = {}): string {
  const file = path.join(dir, name);
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', video, ...(audio ? ['-f', 'lavfi', '-i', audio] : []), '-t', String(seconds), ...codec,
    ...(audio ? [...audioCodec, '-af', `volume=${volume}`] : []), '-shortest', file];
  const out = spawnSync('ffmpeg', args, {encoding: 'utf8'});
  assert.equal(out.status, 0, out.stderr);
  return file;
}

const EXPECT: AuditExpectation = {width: 320, height: 180, fps: 30, durationInFrames: 60, audio: true, loop: false};
const codes = (r: {findings: {code: string}[]}) => r.findings.map((f) => f.code);

describe('auditRender', () => {
  it('passes a file that is what its timeline promised', async () => {
    const r = await auditRender(make('good.mp4'), EXPECT);
    assert.deepEqual(codes(r), []);
    assert.equal(r.passed, true);
    assert.deepEqual(r.checks, ['decode', 'streams', 'duration']);
  });

  it('refuses the wrong size, frame rate and pixel format, and says what it measured', async () => {
    const r = await auditRender(make('wrong.mp4', {video: 'testsrc2=size=640x360:rate=25', codec: ['-c:v', 'libx264', '-pix_fmt', 'yuv444p']}), EXPECT);
    assert.ok(codes(r).includes('wrong-video'));
    const f = r.findings.find((x) => x.code === 'wrong-video')!;
    assert.deepEqual(f.measured, {codec: 'h264', pixelFormat: 'yuv444p', width: 640, height: 360, fps: 25});
  });

  it('refuses audio that is not AAC at 48 kHz', async () => {
    const r = await auditRender(make('mp3.mkv', {audio: 'sine=frequency=440:sample_rate=44100', audioCodec: ['-c:a', 'libmp3lame']}), EXPECT);
    assert.ok(codes(r).includes('wrong-audio'));
  });

  it('refuses a file that lasts more than a frame longer or shorter than its timeline', async () => {
    assert.ok(codes(await auditRender(make('long.mp4', {seconds: 2.5}), EXPECT)).includes('wrong-duration'));
    assert.deepEqual(codes(await auditRender(make('exact.mp4', {seconds: 2}), {...EXPECT, durationInFrames: 61})), []);
  });

  it('refuses a file shorter than its timeline, and sound that stops before the picture', async () => {
    assert.ok(codes(await auditRender(make('short.mp4', {seconds: 1.5}), EXPECT)).includes('wrong-duration'));
    const file = path.join(dir, 'short-sound.mp4');
    const out = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5',
      '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file], {encoding: 'utf8'});
    assert.equal(out.status, 0, out.stderr);
    const r = await auditRender(file, EXPECT);
    assert.ok(r.findings.some((f) => f.code === 'wrong-duration' && /sound/.test(f.message)), JSON.stringify(r.findings));
  });

  it('says silent sound is silent, not NaN', async () => {
    const r = await auditRender(make('silent.mp4', {volume: '0'}), {...EXPECT, loudness: {integrated: -14, truePeak: -1, range: 11}});
    const f = r.findings.find((x) => x.code === 'loudness-off')!;
    assert.match(f.message, /silent/);
    assert.doesNotMatch(f.message, /NaN/);
  });

  it('takes the loop\'s last frame from the file, even a frame short of its timeline', async () => {
    const still = make('still-short.mp4', {video: 'color=c=navy:size=320x180:rate=30'});
    assert.deepEqual(codes(await auditRender(still, {...EXPECT, durationInFrames: 61, loop: true})), []);
  });

  it('refuses a truncated file at once, with nothing else checked', async () => {
    const good = readFileSync(make('whole.mp4', {seconds: 2}));
    const cut = path.join(dir, 'cut.mp4');
    writeFileSync(cut, good.subarray(0, Math.floor(good.length / 2)));
    const r = await auditRender(cut, EXPECT);
    assert.deepEqual(codes(r), ['decode-errors']);
    assert.deepEqual(r.checks, ['decode']);
  });

  it('decodes in stretches at once and finds a fault in any of them, sound or none', async () => {
    const codec = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30'];
    const long = {...EXPECT, durationInFrames: 180};
    const good = make('stretches.mp4', {seconds: 6, codec});
    assert.deepEqual(codes(await auditRender(good, long, {decoders: 3})), []);
    assert.deepEqual(codes(await auditRender(make('stretches-silent.mp4', {seconds: 6, codec, audio: null}), {...long, audio: false}, {decoders: 3})), []);
    // Garbage in the picture two thirds in: the last stretch's decoder meets it.
    const bytes = readFileSync(good);
    const broken = path.join(dir, 'stretches-broken.mp4');
    const at = Math.floor(bytes.length * 0.7);
    bytes.fill(0x5a, at, at + 4000);
    writeFileSync(broken, bytes);
    assert.deepEqual(codes(await auditRender(broken, long)), ['decode-errors'], 'one decoder sees it');
    assert.deepEqual(codes(await auditRender(broken, long, {decoders: 3})), ['decode-errors'], 'so do three');
    // A file whose length cannot be read is decoded whole, which says why.
    const cut = path.join(dir, 'stretches-cut.mp4');
    writeFileSync(cut, readFileSync(good).subarray(0, Math.floor(bytes.length / 2)));
    assert.deepEqual(codes(await auditRender(cut, long, {decoders: 3})), ['decode-errors']);
  });

  it('measures loudness against the target when there is sound', async () => {
    const target = {integrated: -14, truePeak: -1, range: 11};
    const quiet = await auditRender(make('quiet.mp4', {volume: '0.01'}), {...EXPECT, loudness: target});
    assert.ok(quiet.checks.includes('loudness'));
    assert.ok(codes(quiet).includes('loudness-off'));
  });

  it('checks the loop only when the timeline declares one: a still loops, a moving picture does not', async () => {
    const still = make('still.mp4', {video: 'color=c=navy:size=320x180:rate=30'});
    const moving = make('moving.mp4');
    assert.deepEqual(codes(await auditRender(still, {...EXPECT, loop: true})), []);
    assert.deepEqual(codes(await auditRender(moving, {...EXPECT, loop: true})), ['loop-broken']);
    assert.deepEqual(codes(await auditRender(moving, EXPECT)), []);
  });
});

describe('auditExpectation', () => {
  const base = {
    apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline', episodeRef: {channel: 'c', series: 's', episode: 'e'}, revision: 1, fps: 30, durationInFrames: 90,
    resolution: {width: 1920, height: 1080},
    profile: {id: 'youtube-1920x1080', width: 1920, height: 1080, safeZone: {top: 54, right: 96, bottom: 54, left: 96}, loudness: {integrated: -14, truePeak: -1, range: 11}},
    assets: {v: {kind: 'audio', path: 'a.wav', hash: `sha256:${'0'.repeat(64)}`}},
  };
  const visual = {type: 'visual', id: 'main', items: [{id: 'i', kit: {name: 'still', version: '1.0.0'}, from: 0, duration: 90, props: {}}]};
  const sound = (muted: boolean) => ({type: 'audio', id: 'voice', muted, items: [{id: 'a', asset: 'v', from: 0, duration: 90}]});

  it('reads sound, loudness and loop from the timeline', () => {
    const t = EditTimelineSchema.parse({...base, tracks: [visual, sound(false)], loop: true});
    assert.deepEqual(auditExpectation(t), {width: 1920, height: 1080, fps: 30, durationInFrames: 90, audio: true, loudness: {integrated: -14, truePeak: -1, range: 11}, loop: true});
  });

  it('expects no sound from muted tracks, and no loop unless declared', () => {
    const t = EditTimelineSchema.parse({...base, tracks: [visual, sound(true)]});
    assert.deepEqual(auditExpectation(t), {width: 1920, height: 1080, fps: 30, durationInFrames: 90, audio: false, loop: false});
  });
});
