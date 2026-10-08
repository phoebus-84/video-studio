// auditRender: is a rendered file what its timeline promised? It decodes
// cleanly; its streams have the timeline's codecs, size, frame rate and pixel
// format; it lasts the timeline's frames; its loudness is on target; and,
// when the timeline loops, its last frame is its first. Findings, never
// exceptions, for a bad file: the caller decides what a failed audit means.

import {spawn} from 'node:child_process';
import type {LoudnessTarget} from './loudness.js';
import {isAudioItem, type EditTimeline} from './schema.js';

export interface AuditExpectation {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** The file must carry the timeline's sound: AAC at 48 kHz, on its loudness target. */
  audio: boolean;
  loudness?: LoudnessTarget;
  /** The last frame must be the first (a loop). */
  loop: boolean;
}

export interface AuditFinding {
  code: 'decode-errors' | 'wrong-video' | 'wrong-audio' | 'wrong-duration' | 'loudness-off' | 'loop-broken';
  message: string;
  measured?: unknown;
  expected?: unknown;
}

export interface AuditResult {
  passed: boolean;
  /** The checks that ran, in order. */
  checks: string[];
  findings: AuditFinding[];
}

/** The FFmpeg and FFprobe to run; by default the ones every other step of a render uses (FFMPEG_PATH, FFPROBE_PATH, else on the PATH). */
export interface AuditTools {
  ffmpeg?: string;
  ffprobe?: string;
}

/** The sound may end this much (s) before or after the picture: AAC's priming and padding, never a cut. */
export const SOUND_DURATION_TOLERANCE = 0.2;
/** Loudness may miss its target by this much (LU); true peak may exceed its ceiling by this much (dB). */
export const LOUDNESS_TOLERANCE = 1;
export const TRUE_PEAK_TOLERANCE = 0.3;
/** Mean difference (0–255) allowed between first and last frame at 64×36 grey: compression noise, not a change of scene. */
export const LOOP_TOLERANCE = 2;

function run(command: string, args: string[]): Promise<{code: number; stdout: Buffer; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({code: code ?? -1, stdout: Buffer.concat(out), stderr}));
  });
}

interface Stream {codec_type: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; avg_frame_rate?: string; sample_rate?: string; nb_frames?: string; duration?: string}

const rate = (r: string | undefined) => {
  const [n, d] = (r ?? '0/1').split('/').map(Number);
  return d ? n! / d : 0;
};

/** The expectation a validated timeline sets for its render. */
export function auditExpectation(timeline: EditTimeline): AuditExpectation {
  const audio = timeline.tracks.some((t) => t.type === 'audio' && !t.muted && t.items.some(isAudioItem));
  return {
    width: timeline.resolution.width,
    height: timeline.resolution.height,
    fps: timeline.fps,
    durationInFrames: timeline.durationInFrames,
    audio,
    ...(audio ? {loudness: timeline.profile.loudness} : {}),
    loop: timeline.loop === true,
  };
}

/** One frame of the file, scaled to 64×36 grey, as raw bytes. */
async function frame(ffmpeg: string, file: string, index: number): Promise<Buffer> {
  const {code, stdout, stderr} = await run(ffmpeg, ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${index}),scale=64:36,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-']);
  if (code !== 0) throw new Error(`ffmpeg could not read frame ${index}: ${stderr.slice(-400)}`);
  return stdout;
}

export async function auditRender(file: string, expect: AuditExpectation, tools: AuditTools = {}): Promise<AuditResult> {
  const ffmpeg = tools.ffmpeg ?? (process.env.FFMPEG_PATH || 'ffmpeg');
  const ffprobe = tools.ffprobe ?? (process.env.FFPROBE_PATH || 'ffprobe');
  const checks: string[] = [];
  const findings: AuditFinding[] = [];

  checks.push('decode');
  const decoded = await run(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-']);
  const errors = decoded.stderr.trim();
  if (decoded.code !== 0 || errors) {
    findings.push({code: 'decode-errors', message: `the file does not decode cleanly: ${errors.split('\n').slice(0, 3).join(' | ') || `ffmpeg exited ${decoded.code}`}`});
    // Nothing else can be trusted about a file that does not decode.
    return {passed: false, checks, findings};
  }

  checks.push('streams');
  const probed = await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,sample_rate,nb_frames,duration', '-of', 'json', file]);
  if (probed.code !== 0) throw new Error(`ffprobe could not read ${file}: ${probed.stderr.slice(-400)}`);
  const streams = (JSON.parse(probed.stdout.toString()) as {streams: Stream[]}).streams;
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const wanted = {codec: 'h264', pixelFormat: 'yuv420p', width: expect.width, height: expect.height, fps: expect.fps};
  const got = video ? {codec: video.codec_name, pixelFormat: video.pix_fmt, width: video.width, height: video.height, fps: Math.round(rate(video.avg_frame_rate) * 1000) / 1000} : null;
  if (!got || got.codec !== wanted.codec || got.pixelFormat !== wanted.pixelFormat || got.width !== wanted.width || got.height !== wanted.height || Math.abs(got.fps - wanted.fps) > 0.01) {
    findings.push({code: 'wrong-video', message: got ? `the video is ${got.codec} ${got.pixelFormat} ${got.width}×${got.height} at ${got.fps} fps, not h264 yuv420p ${wanted.width}×${wanted.height} at ${wanted.fps} fps` : 'the file has no video stream', measured: got, expected: wanted});
  }
  if (expect.audio && (!audio || audio.codec_name !== 'aac' || audio.sample_rate !== '48000')) {
    findings.push({code: 'wrong-audio', message: audio ? `the audio is ${audio.codec_name} at ${audio.sample_rate} Hz, not aac at 48000 Hz` : 'the file has no audio stream', measured: audio ? {codec: audio.codec_name, sampleRate: Number(audio.sample_rate)} : null, expected: {codec: 'aac', sampleRate: 48000}});
  }

  checks.push('duration');
  const frames = video ? (video.nb_frames && Number(video.nb_frames) > 0 ? Number(video.nb_frames) : Math.round(Number(video.duration ?? 0) * expect.fps)) : 0;
  if (video && Math.abs(frames - expect.durationInFrames) > 1) {
    findings.push({code: 'wrong-duration', message: `the video lasts ${frames} frames, not ${expect.durationInFrames} (± 1)`, measured: frames, expected: expect.durationInFrames});
  }
  if (expect.audio && audio) {
    const seconds = Number(audio.duration ?? 0);
    const wantedSeconds = expect.durationInFrames / expect.fps;
    if (!(Math.abs(seconds - wantedSeconds) <= SOUND_DURATION_TOLERANCE)) {
      findings.push({code: 'wrong-duration', message: `the sound lasts ${seconds.toFixed(2)} s, not the picture's ${wantedSeconds.toFixed(2)} s (± ${SOUND_DURATION_TOLERANCE})`, measured: seconds, expected: wantedSeconds});
    }
  }

  if (expect.audio && expect.loudness && audio) {
    checks.push('loudness');
    const t = expect.loudness;
    const measured = await run(ffmpeg, ['-hide_banner', '-i', file, '-vn', '-af', `loudnorm=I=${t.integrated}:TP=${t.truePeak}:LRA=${t.range}:print_format=json`, '-f', 'null', '-']);
    const start = measured.stderr.lastIndexOf('{');
    const end = measured.stderr.lastIndexOf('}');
    if (measured.code !== 0 || start < 0 || end < start) throw new Error(`ffmpeg could not measure the loudness of ${file}`);
    const report = JSON.parse(measured.stderr.slice(start, end + 1)) as Record<string, string>;
    // FFmpeg prints -inf for silence
    const level = (v: string | undefined) => (v === '-inf' ? -Infinity : Number(v));
    const integrated = level(report.input_i);
    const truePeak = level(report.input_tp);
    if (integrated === -Infinity) {
      findings.push({code: 'loudness-off', message: `the sound is silent, not ${t.integrated} LUFS`, measured: {integrated: null, truePeak: null}, expected: {integrated: t.integrated, truePeak: t.truePeak}});
    } else if (!(Math.abs(integrated - t.integrated) <= LOUDNESS_TOLERANCE) || !(truePeak <= t.truePeak + TRUE_PEAK_TOLERANCE)) {
      findings.push({code: 'loudness-off', message: `the loudness is ${integrated} LUFS with a true peak of ${truePeak} dBTP, not ${t.integrated} ± ${LOUDNESS_TOLERANCE} LUFS under ${t.truePeak} dBTP`, measured: {integrated, truePeak}, expected: {integrated: t.integrated, truePeak: t.truePeak}});
    }
  }

  if (expect.loop) {
    checks.push('loop');
    const first = await frame(ffmpeg, file, 0);
    // the file's own last frame: it may be a frame short of its timeline and still pass the duration check
    const last = await frame(ffmpeg, file, Math.max(0, (frames || expect.durationInFrames) - 1));
    const n = Math.min(first.length, last.length);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(first[i]! - last[i]!);
    const mean = n ? sum / n : 255;
    if (!n || mean > LOOP_TOLERANCE) {
      findings.push({code: 'loop-broken', message: `the last frame is not the first: they differ by ${mean.toFixed(1)} levels on average (at most ${LOOP_TOLERANCE})`, measured: Math.round(mean * 10) / 10, expected: LOOP_TOLERANCE});
    }
  }

  return {passed: findings.length === 0, checks, findings};
}
