import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * A WAV's duration, read from its own header.
 *
 * This used to estimate from file size against a hardcoded 24 kHz mono 16-bit —
 * right for the segments the voice worker emits, and wrong by a factor of two
 * for a 48 kHz mastered final. It also returned a flat five seconds whenever
 * the read failed, so a missing file produced a plausible number rather than an
 * error, and that number went on to shape the timeline, the captions and the
 * render.
 *
 * Chunks are walked rather than assumed at a fixed offset: a WAV may carry LIST
 * or fact chunks before its data, and the 44-byte guess reads those as audio.
 */
export function getWavDuration(wavPath: string): number {
  const bytes = readFileSync(wavPath);
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path.basename(wavPath)} is not a RIFF/WAVE file`);
  }

  let sampleRate = 0;
  let channels = 0;
  let sampleWidthBytes = 0;
  let dataBytes = 0;

  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const id = bytes.toString("ascii", cursor, cursor + 4);
    const size = bytes.readUInt32LE(cursor + 4);
    const body = cursor + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      channels = bytes.readUInt16LE(body + 2);
      sampleRate = bytes.readUInt32LE(body + 4);
      sampleWidthBytes = Math.ceil(bytes.readUInt16LE(body + 14) / 8);
    } else if (id === "data") {
      // A truncated file claims more data than it holds; trust the bytes.
      dataBytes = Math.min(size, bytes.length - body);
      break;
    }
    cursor = body + size + (size % 2);
  }

  const frameBytes = channels * sampleWidthBytes;
  if (!sampleRate || !frameBytes || !dataBytes) {
    throw new Error(`${path.basename(wavPath)} has no readable WAV format or data chunk`);
  }
  return dataBytes / (sampleRate * frameBytes);
}
