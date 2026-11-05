// joinSegments on real one-second files made with FFmpeg: joined in groups
// side by side, the video has the same packets and timestamps as joined in one go.
import {after, before, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {joinSegments} from '../src/cached-render.js';

let dir: string;
before(() => (dir = mkdtempSync(path.join(tmpdir(), 'join-'))));
after(() => rmSync(dir, {recursive: true, force: true}));

const ffmpeg = (args: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {maxBuffer: 64 * 1024 * 1024});
  assert.equal(r.status, 0, r.stderr?.toString());
  return r.stdout;
};
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const packets = (file: string) => digest(ffmpeg(['-i', file, '-map', '0:v', '-c', 'copy', '-f', 'h264', '-']));
const timestamps = (file: string) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts,dts,duration,flags', '-of', 'csv', file], {maxBuffer: 64 * 1024 * 1024});
  assert.equal(r.status, 0, r.stderr?.toString());
  return digest(r.stdout);
};

it('joins many segments in groups at once into the very video one join makes', async () => {
  const count = 26;
  // One run cut into one-second segments, as the render cache keeps them.
  ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=30:duration=${count}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-sc_threshold', '0',
    '-f', 'segment', '-segment_frames', Array.from({length: count - 1}, (_, i) => (i + 1) * 30).join(','), '-reset_timestamps', '1', path.join(dir, 'segment-%d.mp4')]);
  const files = Array.from({length: count}, (_, i) => path.join(dir, `segment-${i}.mp4`));
  await joinSegments(files, path.join(dir, 'one.mp4'), dir, 1);
  await joinSegments(files, path.join(dir, 'grouped.mp4'), dir, 3);
  assert.equal(packets(path.join(dir, 'grouped.mp4')), packets(path.join(dir, 'one.mp4')));
  assert.equal(timestamps(path.join(dir, 'grouped.mp4')), timestamps(path.join(dir, 'one.mp4')));
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('joined-')), [], 'the groups\' files are removed');
});
