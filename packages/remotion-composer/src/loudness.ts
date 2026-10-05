// Two-pass EBU R128 loudness with FFmpeg's loudnorm: measure, then apply with
// the measured values (linear), copying the video stream.

import {spawn} from 'node:child_process';

export interface LoudnessTarget {
  integrated: number;
  truePeak: number;
  range: number;
}

export const DEFAULT_LOUDNESS: LoudnessTarget = {integrated: -15, truePeak: -1, range: 11};

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

export async function normalizeLoudness(
  input: string, output: string, target: LoudnessTarget = DEFAULT_LOUDNESS, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
): Promise<LoudnessResult> {
  const base = `I=${target.integrated}:TP=${target.truePeak}:LRA=${target.range}`;
  const measured = report(await run(ffmpeg, ['-hide_banner', '-i', input, '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-']));
  const second = [
    `loudnorm=${base}`,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
    'print_format=json',
  ].join(':');
  const applied = report(await run(ffmpeg, [
    '-hide_banner', '-y', '-i', input, '-c:v', 'copy', '-af', second, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', output,
  ]));
  return {inputI: Number(measured.input_i), outputI: Number(applied.output_i), truePeak: Number(applied.output_tp)};
}
