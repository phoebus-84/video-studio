// A picture's size read from its own bytes (PNG, JPEG, GIF, WebP, TIFF), so a
// "large original" is checked on what arrived, not on what was announced.

import { closeSync, openSync, readSync } from "node:fs";

export function imageSize(file: string): { width: number; height: number; mime: string } | null {
  const fd = openSync(file, "r");
  try {
    // Metadata (ICC profiles, XMP, previews) can come before a JPEG's frame header.
    const head = Buffer.alloc(4 * 1024 * 1024);
    const n = readSync(fd, head, 0, head.length, 0);
    return sizeOf(head.subarray(0, n));
  } finally {
    closeSync(fd);
  }
}

export function sizeOf(b: Buffer): { width: number; height: number; mime: string } | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), mime: "image/png" };
  if (b.length >= 10 && b.toString("ascii", 0, 3) === "GIF") return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), mime: "image/gif" };
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), mime: "image/webp" };
    if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, mime: "image/webp" };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, mime: "image/webp" };
    }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const length = b.readUInt16BE(i + 2);
      // SOF0–SOF15, but DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), mime: "image/jpeg" };
      }
      i += 2 + length;
    }
    return null;
  }
  if (b.length >= 8 && (b.toString("ascii", 0, 2) === "II" || b.toString("ascii", 0, 2) === "MM")) {
    const le = b.toString("ascii", 0, 2) === "II";
    const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
    if (u16(2) !== 42) return null;
    const ifd = u32(4);
    if (ifd + 2 > b.length) return null;
    let width = 0;
    let height = 0;
    for (let k = 0; k < u16(ifd); k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > b.length) break;
      const tag = u16(e);
      const value = u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8);
      if (tag === 256) width = value;
      if (tag === 257) height = value;
    }
    return width && height ? { width, height, mime: "image/tiff" } : null;
  }
  return null;
}
