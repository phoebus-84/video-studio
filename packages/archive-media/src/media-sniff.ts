// What a video, a sound or a font file is, read from its first bytes: a host that
// answers 200 with a login page or an error is never saved as media.

import { closeSync, openSync, readSync } from "node:fs";
import type { MediaType } from "./types.js";

export function sniffMedia(file: string): { mediaType: MediaType; mime: string } | null {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(64);
    const n = readSync(fd, head, 0, head.length, 0);
    return sniff(head.subarray(0, n));
  } finally {
    closeSync(fd);
  }
}

export function sniff(b: Buffer): { mediaType: MediaType; mime: string } | null {
  const ascii = (from: number, to: number) => (b.length >= to ? b.toString("latin1", from, to) : "");
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (/^(M4A |M4B |M4P )$/.test(brand)) return { mediaType: "audio", mime: "audio/mp4" };
    return { mediaType: "video", mime: brand === "qt  " ? "video/quicktime" : "video/mp4" };
  }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return { mediaType: "video", mime: "video/webm" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { mediaType: "audio", mime: "audio/wav" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return { mediaType: "video", mime: "video/x-msvideo" };
  if (ascii(0, 4) === "fLaC") return { mediaType: "audio", mime: "audio/flac" };
  if (ascii(0, 4) === "OggS") {
    const text = b.toString("latin1");
    return text.includes("theora") ? { mediaType: "video", mime: "video/ogg" } : { mediaType: "audio", mime: "audio/ogg" };
  }
  if (ascii(0, 3) === "ID3" || (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && (b[1]! & 0x06) !== 0)) return { mediaType: "audio", mime: "audio/mpeg" };
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && (b[3] === 0xba || b[3] === 0xb3)) return { mediaType: "video", mime: "video/mpeg" };
  if (b.length >= 2 && b[0] === 0xff && (b[1] === 0xf1 || b[1] === 0xf9)) return { mediaType: "audio", mime: "audio/aac" };
  if (ascii(0, 4) === "wOF2") return { mediaType: "font", mime: "font/woff2" };
  if (ascii(0, 4) === "wOFF") return { mediaType: "font", mime: "font/woff" };
  if (ascii(0, 4) === "OTTO") return { mediaType: "font", mime: "font/otf" };
  if ((b.length >= 4 && b.readUInt32BE(0) === 0x00010000) || ascii(0, 4) === "true") return { mediaType: "font", mime: "font/ttf" };
  return null;
}
