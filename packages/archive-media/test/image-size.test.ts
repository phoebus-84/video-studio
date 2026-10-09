import { describe, expect, it } from "vitest";
import { sizeOf } from "../src/image-size.js";

/** The smallest headers of each format, with a known size. */
function png(w: number, h: number) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w: number, h: number) {
  // SOI, an APP0 segment, a DHT (C4: not a frame), then SOF2.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const dht = Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc2, 0); sof.writeUInt16BE(11, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dht, sof]);
}

describe("sizeOf", () => {
  it("reads PNG, JPEG (past a DHT), GIF and TIFF headers", () => {
    expect(sizeOf(png(5736, 3319))).toEqual({ width: 5736, height: 3319, mime: "image/png" });
    expect(sizeOf(jpeg(3000, 2056))).toEqual({ width: 3000, height: 2056, mime: "image/jpeg" });
    const gif = Buffer.from("GIF89a\x10\x00\x20\x00", "latin1");
    expect(sizeOf(gif)).toEqual({ width: 16, height: 32, mime: "image/gif" });
    const tiff = Buffer.alloc(40);
    tiff.write("II", 0, "ascii"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(2, 8);
    tiff.writeUInt16LE(256, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(4813, 18);
    tiff.writeUInt16LE(257, 22); tiff.writeUInt16LE(4, 24); tiff.writeUInt32LE(1, 26); tiff.writeUInt32LE(5794, 30);
    expect(sizeOf(tiff)).toEqual({ width: 4813, height: 5794, mime: "image/tiff" });
  });

  it("says nothing of what is not a picture", () => {
    expect(sizeOf(Buffer.from("<!DOCTYPE html><html>Just a moment...</html>"))).toBeNull();
    expect(sizeOf(Buffer.alloc(0))).toBeNull();
  });
});
