// ---------------------------------------------------------------------------
// Deterministic nonverbal character audio
// ---------------------------------------------------------------------------
// Generates short, speech-free expressive buzz cues as canonical PCM WAV.
// The synthesis is deterministic and local, so previews and reruns do not
// require TTS or a paid provider.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

export const NONVERBAL_EMOTIONS = [
  "excitement",
  "concentration",
  "pain",
  "embarrassment",
  "challenge",
  "idea",
  "defeat",
] as const;

export type NonverbalEmotion = typeof NONVERBAL_EMOTIONS[number];

interface BuzzProfile {
  startHz: number;
  endHz: number;
  pulseHz: number;
  harmonic: number;
  roughness: number;
}

const PROFILES: Record<NonverbalEmotion, BuzzProfile> = {
  excitement: { startHz: 330, endHz: 640, pulseHz: 13, harmonic: 0.28, roughness: 0.02 },
  concentration: { startHz: 185, endHz: 215, pulseHz: 3.2, harmonic: 0.34, roughness: 0.015 },
  pain: { startHz: 880, endHz: 760, pulseHz: 18, harmonic: 0.18, roughness: 0.03 },
  embarrassment: { startHz: 350, endHz: 285, pulseHz: 6.5, harmonic: 0.25, roughness: 0.08 },
  challenge: { startHz: 165, endHz: 245, pulseHz: 2.2, harmonic: 0.42, roughness: 0.025 },
  idea: { startHz: 510, endHz: 690, pulseHz: 8, harmonic: 0.22, roughness: 0.01 },
  defeat: { startHz: 360, endHz: 105, pulseHz: 2.8, harmonic: 0.3, roughness: 0.04 },
};

export interface NonverbalAudioResult {
  outputPath: string;
  emotion: NonverbalEmotion;
  durationSeconds: number;
  sampleRate: number;
  channels: 1;
  bytes: number;
}

function seededRandom(seed: string): () => number {
  const digest = createHash("sha256").update(seed).digest();
  let state = digest.readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function writeWavHeader(buffer: Buffer, sampleRate: number, sampleCount: number): void {
  const dataBytes = sampleCount * 2;
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
}

export async function synthesizeNonverbalBuzz(options: {
  emotion: NonverbalEmotion;
  durationSeconds: number;
  outputPath: string;
  seed?: string;
  gain?: number;
  sampleRate?: number;
}): Promise<NonverbalAudioResult> {
  if (!NONVERBAL_EMOTIONS.includes(options.emotion)) throw new Error(`Unsupported nonverbal emotion: ${options.emotion}`);
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds < 0.1 || options.durationSeconds > 8) {
    throw new Error("durationSeconds must be from 0.1 to 8");
  }
  const gain = options.gain ?? 0.72;
  if (!Number.isFinite(gain) || gain <= 0 || gain > 1) throw new Error("gain must be greater than 0 and at most 1");
  const sampleRate = options.sampleRate ?? 48_000;
  if (![24_000, 44_100, 48_000].includes(sampleRate)) throw new Error("sampleRate must be 24000, 44100, or 48000");

  const profile = PROFILES[options.emotion];
  const sampleCount = Math.round(options.durationSeconds * sampleRate);
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  writeWavHeader(buffer, sampleRate, sampleCount);
  const random = seededRandom(options.seed ?? `${options.emotion}:${options.durationSeconds}`);
  let phase = 0;

  for (let i = 0; i < sampleCount; i++) {
    const progress = i / Math.max(1, sampleCount - 1);
    const attack = Math.min(1, progress / 0.04);
    const release = Math.min(1, (1 - progress) / 0.09);
    let envelope = Math.min(attack, release);
    let pulse = 0.62 + 0.38 * Math.sin(2 * Math.PI * profile.pulseHz * (i / sampleRate));

    if (options.emotion === "idea") {
      const first = Math.exp(-Math.pow((progress - 0.25) / 0.15, 2));
      const second = Math.exp(-Math.pow((progress - 0.72) / 0.15, 2));
      envelope *= Math.min(1, (first + second) * 1.35);
    } else if (options.emotion === "embarrassment") {
      pulse *= random() > 0.045 ? 1 : 0.08;
    } else if (options.emotion === "pain") {
      envelope *= progress < 0.72 ? 1 : Math.max(0, 1 - (progress - 0.72) / 0.28);
    }

    const wobble = (random() * 2 - 1) * profile.roughness;
    const frequency = profile.startHz + (profile.endHz - profile.startHz) * progress;
    phase += (2 * Math.PI * frequency * (1 + wobble)) / sampleRate;
    const carrier = Math.sin(phase);
    const harmonic = Math.sin(phase * 2.01) * profile.harmonic;
    const sample = Math.max(-1, Math.min(1, (carrier + harmonic) * envelope * pulse * gain));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }

  const outputPath = path.resolve(options.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);

  return {
    outputPath,
    emotion: options.emotion,
    durationSeconds: sampleCount / sampleRate,
    sampleRate,
    channels: 1,
    bytes: buffer.length,
  };
}
