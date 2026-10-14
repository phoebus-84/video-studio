import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const workdir = () => mkdtempSync(join(tmpdir(), "audio-edit-test-"));

/** A sine of `freq` Hz, `seconds` long, at `db` dBFS peak, 48 kHz mono WAV (float when `float`). */
export function tone(dir: string, name: string, freq: number, seconds: number, db = -12, float = false): string {
  const file = join(dir, name);
  const amp = Math.pow(10, db / 20);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=${amp}*sin(2*PI*${freq}*t):s=48000:d=${seconds}`,
    "-ac", "1", ...(float ? ["-c:a", "pcm_f32le"] : []), file]);
  return file;
}

/** Silence, then a tone, then silence. */
export function framed(dir: string, name: string, head: number, body: number, tail: number): string {
  const file = join(dir, name);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `anullsrc=r=48000:cl=mono:d=${head}`,
    "-f", "lavfi", "-i", `aevalsrc=0.35*sin(2*PI*330*t):s=48000:d=${body}`,
    "-f", "lavfi", "-i", `anullsrc=r=48000:cl=mono:d=${tail}`,
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1", "-ac", "1", file]);
  return file;
}

/** Pink noise, `seconds` long, 48 kHz mono. */
export function noise(dir: string, name: string, seconds: number, db = -20): string {
  const file = join(dir, name);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `anoisesrc=color=pink:sample_rate=48000:duration=${seconds}:seed=7`, "-af", `volume=${db}dB`, "-ac", "1", file]);
  return file;
}

/** Mono float samples of a file. */
export function pcm(file: string, from = 0, seconds?: number): Float32Array {
  const buf = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(from), ...(seconds ? ["-t", String(seconds)] : []), "-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 512 * 1024 * 1024 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

export const rmsDb = (x: Float32Array) => {
  let s = 0;
  for (const v of x) s += v * v;
  return 20 * Math.log10(Math.sqrt(s / x.length));
};

/** Dominant frequency by zero crossings. */
export const frequency = (x: Float32Array) => {
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) crossings++;
  return (crossings / 2) / (x.length / 48000);
};
