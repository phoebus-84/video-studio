/**
 * Fake process execution for deterministic tests.
 *
 * Uses the process-factory injection point to replace child_process.spawn
 * with a fake implementation that returns pre-configured output without
 * executing real binaries.
 */

import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { setSpawn } from "../../src/process-factory.js";
import type { SpawnFn } from "../../src/process-factory-types.js";

// ─── Call recording ──────────────────────────────────────────────────────

export interface RecordedCall {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

let recordedCalls: RecordedCall[] = [];

export function clearRecordedCalls(): void {
  recordedCalls = [];
}

export function getRecordedCalls(): readonly RecordedCall[] {
  return recordedCalls;
}

// ─── Fake responses ──────────────────────────────────────────────────────

export interface FakeResponse {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  signal?: string | null;
  delayMs?: number;
  error?: Error;
}

const fakeResponses = new Map<string, FakeResponse>();

/**
 * Configure a fake response for a command name (e.g. "ffmpeg").
 * When spawn is called with that command, the fake is used instead.
 * An empty string key matches any command.
 */
export function setFake(command: string, response: FakeResponse): void {
  fakeResponses.set(command, response);
}

export function clearFakes(): void {
  fakeResponses.clear();
}

function getFake(command: string): FakeResponse | undefined {
  return fakeResponses.get(command) ?? fakeResponses.get("");
}

// ─── Fake ChildProcess ───────────────────────────────────────────────────

class FakeChildProcess extends EventEmitter {
  // No OS PID: unit-test cancellation must never signal an unrelated process.
  public pid: number | undefined = undefined;
  public stdout: Readable | null = null;
  public stderr: Readable | null = null;
  public stdin: Writable | null = null;
  private killed = false;
  public exitCode: number | null = null;
  public signalCode: string | null = null;

  constructor(response: FakeResponse) {
    super();

    const hasStdout = response.stdout !== undefined || Object.hasOwn(response, "stdout");
    const hasStderr = response.stderr !== undefined || Object.hasOwn(response, "stderr");

    if (hasStdout) {
      const out = new Readable({ read() {} });
      this.stdout = out;
      const delay = response.delayMs ?? 0;
      setTimeout(() => {
        if (!this.killed) {
          out.push(response.stdout ?? "");
          out.push(null);
        }
      }, delay);
    } else {
      this.stdout = null;
    }

    if (hasStderr) {
      const err = new Readable({ read() {} });
      this.stderr = err;
      const delay = response.delayMs ?? 0;
      setTimeout(() => {
        if (!this.killed) {
          err.push(response.stderr ?? "");
          err.push(null);
        }
      }, delay);
    } else {
      this.stderr = null;
    }

    // Close after delay
    const closeDelay = (response.delayMs ?? 0) + 1;
    setTimeout(() => {
      if (!this.killed) {
        this.exitCode = response.exitCode ?? 0;
        this.signalCode = response.signal ?? null;
        this.emit("close", this.exitCode, this.signalCode);
      }
    }, closeDelay);
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.signalCode = signal ?? "SIGTERM";
    this.exitCode = null;
    // Emit close asynchronously so that reject/resolve paths in the
    // process-runner have a chance to execute before the close handler.
    setImmediate(() => this.emit("close", null, this.signalCode));
    return true;
  }

  ref(): void {}
  unref(): void {}
}

// ─── Fake spawn factory ──────────────────────────────────────────────────

let restore: (() => void) | null = null;

function createFakeSpawn(): SpawnFn {
  return (command: string, args?: readonly string[], options?) => {
    recordedCalls.push({
      command,
      args: args ? [...args] : [],
      options: { ...options },
    });

    const fake = getFake(command);
    if (fake) {
      if (fake.error) {
        const proc = new FakeChildProcess({ exitCode: 1 });
        setTimeout(() => proc.emit("error", fake.error), 0);
        return proc as unknown as ChildProcess;
      }
      return new FakeChildProcess(fake) as unknown as ChildProcess;
    }

    // No fake configured for this command — return a failing one
    const proc = new FakeChildProcess({ exitCode: 1, stderr: "command not found" });
    setTimeout(() => proc.emit("error", new Error("ENOENT")), 0);
    return proc as unknown as ChildProcess;
  };
}

/**
 * Install the fake spawn interceptor.
 * After calling this, all spawn() calls use fake responses instead of real processes.
 */
export function installFakeSpawn(): void {
  if (restore) return; // Already installed
  restore = setSpawn(createFakeSpawn());
}

/**
 * Uninstall the fake spawn interceptor, restoring the real spawn.
 */
export function uninstallFakeSpawn(): void {
  if (restore) {
    restore();
    restore = null;
  }
}

// ─── Helpers for fake FFmpeg output ──────────────────────────────────────

export const FAKE_FFMPEG_VERSION = `ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers
built with Apple clang version 15.0.0 (clang-1500.3.9.4)
configuration: --enable-gpl --enable-libx264 --enable-libx265
libavutil      58. 29.100 / 58. 29.100
libavcodec     60. 31.102 / 60. 31.102
libavformat    60. 16.100 / 60. 16.100
libavdevice    60.  3.100 / 60.  3.100
libavfilter     9. 12.100 /  9. 12.100
libswscale      7.  5.100 /  7.  5.100
libswresample   4. 12.100 /  4. 12.100`;

export const FAKE_FFMPEG_CODECS = `Codecs:
 D..... = Decoding supported
 .E.... = Encoding supported
 ..V... = Video codec
 ..A... = Audio codec
 ..S... = Subtitle codec
 ...I.. = Intra frame-only codec
 ....L. = Lossy compression
 .....S = Lossless compression
 -------
 DEV.LS h264             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (encoders: libx264 libx264rgb)
 DEV.L. hevc             H.265 / HEVC (High Efficiency Video Coding) (encoders: libx265)
 D.V.L. vp9              Google VP9
 D.A.L. mp3              MP3 (MPEG audio layer 3) (decoders: mp3 mp3float)
 DEA.L. aac              AAC (Advanced Audio Coding) (encoders: aac aac_mf)
 D.A.L. opus             Opus (Opus Interactive Audio Codec) (decoders: opus libopus)
 D.A.L. vorbis           Vorbis
 D.A... pcm_s16le        PCM signed 16-bit little-endian
 D.A... pcm_s24le        PCM signed 24-bit little-endian
 .EV... libx264          libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 .EV... libx265          libx265 H.265 / HEVC (codec hevc)`;

export const FAKE_FFMPEG_FILTERS = `Filters:
  T.. = Timeline support
  .S. = Slice threading
  ..C = Command support
  A = Audio input/output
  V = Video input/output
  N = Dynamic number and/or type of input/output
  | = Source or sink filter
 -------
 T.. scale           V->V       Scale the input video.
 T.. fps             V->V       Force constant framerate.
 TSC trim            V->V       Pick one continuous section from the input.
 T.. setpts          V->V       Set PTS for the output video frame.
 ... format          V->V       Convert the input video to one of the specified pixel formats.
 TSC overlay         VV->V      Overlay a video on top of another.
 ... concat          VV->V      Concatenate audio and video streams.
 ... split           V->N       Split input into several identical outputs.
 ... null            V->V       Pass the source unchanged to the output.
 T.. anull           A->A       Pass the audio source unchanged to the output.
 T.. atrim           A->A       Pick one continuous section from the input.
 T.. asetpts         A->A       Set PTS for the output audio frame.
 ... aconcat         AA->A      Concatenate audio streams.
 T.. volume          A->A       Change input volume.
 T.. loudnorm        A->A       EBU R128 loudness normalization.
 ... aresample       A->A       Resample audio data.
 ... aformat         A->A       Convert the input audio to one of the specified formats.
 ... amix            AA->A      Audio mixing.`;

/**
 * Install fakes for the common FFmpeg commands used during discovery.
 */
export function installFakeFfmpeg(): void {
  installFakeSpawn();
  setFake("ffmpeg", { stdout: FAKE_FFMPEG_VERSION, exitCode: 0 });
  setFake("/bin/sh", { stdout: "/usr/local/bin/ffmpeg", exitCode: 0 });
}
