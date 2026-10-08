// normalizeLoudness: the file it writes — after the AAC encode, not before —
// meets the loudness the render audit holds it to. AAC adds inter-sample
// peaks, so a normalisation aimed exactly at the true-peak ceiling ends above
// it (the long Il lampo's first render: −0.53 dBTP against −1).

import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {normalizeLoudness} from '../src/loudness.js';
import {LOUDNESS_TOLERANCE} from '../src/audit.js';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const TARGET = {integrated: -15, truePeak: -1, range: 11};

/** Integrated loudness and true peak of a file, as the audit measures them. */
function loudness(file: string): {integrated: number; truePeak: number} {
  const run = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-vn', '-af', 'loudnorm=I=-15:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], {encoding: 'utf-8'});
  const text = run.stderr;
  const json = JSON.parse(text.slice(text.lastIndexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, string>;
  return {integrated: Number(json.input_i), truePeak: Number(json.input_tp)};
}

test('the encoded file stays under the true-peak ceiling the audit allows, at the target loudness', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loudness-'));
  try {
    // A peaky mix: pink noise under sharp clicks, the kind AAC overshoots on.
    const input = join(dir, 'mix.wav');
    const made = spawnSync(ffmpeg, ['-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.3:duration=20:seed=7',
      '-f', 'lavfi', '-i', 'aevalsrc=exprs=if(lt(mod(t\\,0.5)\\,0.002)\\,0.95\\,0):d=20:s=48000',
      '-filter_complex', '[0][1]amix=inputs=2:normalize=0', '-ar', '48000', '-c:a', 'pcm_s16le', input]);
    assert.equal(made.status, 0, made.stderr?.toString());
    const output = join(dir, 'out.mp4');
    const result = await normalizeLoudness(input, output, TARGET, ffmpeg);
    const measured = loudness(output);
    assert.ok(measured.truePeak <= TARGET.truePeak, `true peak ${measured.truePeak} dBTP`);
    // what it says it wrote is what the file holds (the render records it)
    assert.deepEqual([result.outputI, result.truePeak], [measured.integrated, measured.truePeak]);
    assert.ok(Math.abs(measured.integrated - TARGET.integrated) <= LOUDNESS_TOLERANCE, `integrated ${measured.integrated} LUFS`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
