// Two-pass EBU R128 loudness with FFmpeg's loudnorm: measure, then apply with
// the measured values (linear), copying the video stream.

import {spawn} from 'node:child_process';

export interface LoudnessTarget {
  integrated: number;
  truePeak: number;
  range: number;
}

export interface LoudnessResult {
  inputI: number;
  outputI: number;
  truePeak: number;
}

function run(ffmpeg: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`))));
  });
}

/** The last {...} block loudnorm prints. */
function report(stderr: string): Record<string, string> {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('loudnorm printed no report');
  return JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
}

/**
 * Headroom left under the true-peak ceiling for the AAC encode, which adds
 * inter-sample peaks: aimed exactly at −1 dBTP, a long lesson came out at
 * −0.53 and failed its audit.
 */
export const ENCODE_HEADROOM = 1;

/** Integrated loudness and true peak of a file's sound, as loudnorm measures them (the audit's measure). */
async function measure(ffmpeg: string, file: string, base: string): Promise<{i: number; tp: number}> {
  const r = report(await run(ffmpeg, ['-hide_banner', '-i', file, '-vn', '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-']));
  return {i: Number(r.input_i), tp: Number(r.input_tp)};
}

export async function normalizeLoudness(
  input: string, output: string, target: LoudnessTarget, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
): Promise<LoudnessResult> {
  const base = `I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}`;
  const measured = report(await run(ffmpeg, ['-hide_banner', '-i', input, '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-']));
  const encode = async (truePeak: number) => {
    const second = [
      `loudnorm=I=${target.integrated}:TP=${truePeak}:LRA=${target.range}`,
      `measured_I=${measured.input_i}`,
      `measured_TP=${measured.input_tp}`,
      `measured_LRA=${measured.input_lra}`,
      `measured_thresh=${measured.input_thresh}`,
      `offset=${measured.target_offset}`,
      'linear=true',
      'print_format=json',
    ].join(':');
    report(await run(ffmpeg, [
      '-hide_banner', '-y', '-i', input, '-c:v', 'copy', '-af', second, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', output,
    ]));
    // What the file holds, after the encode: the audit's measure, not the filter's.
    return measure(ffmpeg, output, base);
  };
  let aim = target.truePeak - ENCODE_HEADROOM;
  let encoded = await encode(aim);
  // Still over the ceiling: once more, lower by what the encode added.
  if (encoded.tp > target.truePeak) {
    aim = Math.max(-9, aim - (encoded.tp - target.truePeak) - 0.2);
    encoded = await encode(aim);
  }
  // Linear gain stops at the peak ceiling: a peaky mix comes out quieter than
  // the target (a 20 s collage at −15.03 against −14). Then the missing gain
  // goes in with a limiter, oversampled so it catches true peaks, and is
  // corrected by what the file measures: the limiter eats part of each step,
  // so a mix whose loudness sits in its peaks takes a few.
  if (encoded.i < target.integrated - LIMIT_BELOW) {
    const ceiling = 10 ** ((target.truePeak - ENCODE_HEADROOM - 0.5) / 20);
    const limited = async (gain: number) => {
      await run(ffmpeg, [
        '-hide_banner', '-y', '-i', input, '-c:v', 'copy',
        '-af', `volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=${ceiling.toFixed(4)}:level=false:attack=1:release=50,aresample=48000`,
        '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', output,
      ]);
      return measure(ffmpeg, output, base);
    };
    let gain = target.integrated - Number(measured.input_i);
    encoded = await limited(gain);
    for (let tries = 1; tries < LIMIT_TRIES && Math.abs(encoded.i - target.integrated) > 0.3; tries++) {
      gain += target.integrated - encoded.i;
      encoded = await limited(gain);
    }
  }
  return {inputI: Number(measured.input_i), outputI: encoded.i, truePeak: encoded.tp};
}

/** How far under the target a linear pass may land before the limiter takes over. */
export const LIMIT_BELOW = 0.5;

/** Limiter encodes at most, each measured. */
export const LIMIT_TRIES = 4;
