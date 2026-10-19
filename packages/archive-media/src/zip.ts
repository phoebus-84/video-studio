// One file out of a ZIP archive, for providers that ship a texture's maps
// zipped (ambientCG). Stored and deflated entries only; ZIP64, encryption and
// names that climb out of the archive are refused.

import { inflateRawSync } from "node:zlib";
import { ArchiveError } from "./errors.js";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

/** Every entry of the central directory. */
export function zipEntries(zip: Buffer): ZipEntry[] {
  const bad = (why: string): never => { throw new ArchiveError("wrong-type", `not a readable ZIP: ${why}`); };
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) bad("no end of central directory");
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) bad("ZIP64 is not supported");
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50) bad("broken central directory");
    const flags = zip.readUInt16LE(at + 8);
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString("utf-8", at + 46, at + 46 + nameLength);
    if (flags & 1) bad(`${name} is encrypted`);
    entries.push({
      name, method: zip.readUInt16LE(at + 10), compressedSize: zip.readUInt32LE(at + 20), size: zip.readUInt32LE(at + 24), offset: zip.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}

/** The bytes of the one entry whose name matches `pattern`; refuses none, several, or one too large. */
export function extractZipEntry(zip: Buffer, pattern: RegExp, maxBytes = 512 * 1024 ** 2): { name: string; bytes: Buffer } {
  const found = zipEntries(zip).filter((e) => !e.name.endsWith("/") && pattern.test(e.name.split("/").pop()!));
  if (found.length !== 1) throw new ArchiveError("no-file", `the archive has ${found.length} files matching ${pattern}`);
  const entry = found[0]!;
  if (entry.name.includes("..") || entry.name.startsWith("/") || entry.name.includes("\\")) throw new ArchiveError("wrong-type", `unsafe name in archive: ${entry.name}`);
  if (entry.size > maxBytes) throw new ArchiveError("too-large", `${entry.name} is ${entry.size} bytes, more than ${maxBytes}`);
  const local = entry.offset;
  if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new ArchiveError("wrong-type", "not a readable ZIP: broken local header");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + entry.compressedSize);
  let bytes: Buffer;
  if (entry.method === 0) bytes = Buffer.from(data);
  else if (entry.method === 8) bytes = inflateRawSync(data, { maxOutputLength: maxBytes });
  else throw new ArchiveError("wrong-type", `${entry.name}: compression method ${entry.method} is not supported`);
  if (bytes.length !== entry.size) throw new ArchiveError("wrong-type", `${entry.name}: ${bytes.length} bytes, the archive says ${entry.size}`);
  return { name: entry.name.split("/").pop()!, bytes };
}
