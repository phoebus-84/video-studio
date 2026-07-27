/**
 * Tests for FFmpeg/ffprobe discovery and output parsing.
 */

import { describe, it, expect } from "vitest";
import { parseVersion, parseCodecs, parseFilters } from "../src/discovery.js";
import {
  FAKE_FFMPEG_VERSION,
  FAKE_FFMPEG_CODECS,
  FAKE_FFMPEG_FILTERS,
} from "./fixtures/fake-ffmpeg.js";

describe("parseVersion", () => {
  it("parses a standard ffmpeg version string", () => {
    const parsed = parseVersion(FAKE_FFMPEG_VERSION);
    expect(parsed).not.toBeNull();
    expect(parsed!.major).toBe(6);
    expect(parsed!.minor).toBe(1);
    expect(parsed!.patch).toBe(1);
    expect(parsed!.raw).toBe("ffmpeg version 6.1.1");
  });

  it("parses two-component versions (e.g. 4.3)", () => {
    const parsed = parseVersion(
      "ffmpeg version 4.3 Copyright (c) 2000-2020",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.major).toBe(4);
    expect(parsed!.minor).toBe(3);
    expect(parsed!.patch).toBe(0);
  });

  it("returns null for unparseable version", () => {
    expect(parseVersion("some random output")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("parseCodecs", () => {
  const codecs = parseCodecs(FAKE_FFMPEG_CODECS);

  it("extracts the correct number of codecs", () => {
    // There are 10 codec entries in the fake output
    expect(codecs.length).toBeGreaterThanOrEqual(10);
  });

  it("parses a codec with decode and encode capability (h264)", () => {
    const h264 = codecs.find((c) => c.name === "h264");
    expect(h264).toBeDefined();
    expect(h264!.type).toBe("video");
    expect(h264!.capabilities).toContain("decode");
    expect(h264!.capabilities).toContain("encode");
    expect(h264!.capabilities).toContain("lossy");
    expect(h264!.capabilities).toContain("lossless");
  });

  it("parses an encode-only codec (libx264)", () => {
    const libx264 = codecs.find((c) => c.name === "libx264");
    expect(libx264).toBeDefined();
    expect(libx264!.type).toBe("video");
    expect(libx264!.capabilities).toContain("encode");
    expect(libx264!.capabilities).not.toContain("decode");
  });

  it("parses an audio codec (aac)", () => {
    const aac = codecs.find((c) => c.name === "aac");
    expect(aac).toBeDefined();
    expect(aac!.type).toBe("audio");
    expect(aac!.capabilities).toContain("decode");
    expect(aac!.capabilities).toContain("encode");
  });

  it("parses a decoder-only codec (vp9)", () => {
    const vp9 = codecs.find((c) => c.name === "vp9")!;
    expect(vp9.type).toBe("video");
    expect(vp9.capabilities).toContain("decode");
    expect(vp9.capabilities).not.toContain("encode");
  });

  it("identifies lossy codecs", () => {
    const aac = codecs.find((c) => c.name === "aac")!;
    expect(aac.capabilities).toContain("lossy");
  });

  it("captures descriptions", () => {
    const vorbis = codecs.find((c) => c.name === "vorbis")!;
    expect(vorbis.description).toBe("Vorbis");
  });
});

describe("parseFilters", () => {
  const filters = parseFilters(FAKE_FFMPEG_FILTERS);

  it("extracts filter entries", () => {
    expect(filters.length).toBeGreaterThan(0);
  });

  it("parses timeline-capable filters", () => {
    const scale = filters.find((f) => f.name === "scale")!;
    expect(scale.timeline).toBe(true);
    expect(scale.slice).toBe(false);
    expect(scale.command).toBe(false);
  });

  it("parses TSC filters", () => {
    const overlay = filters.find((f) => f.name === "overlay")!;
    expect(overlay.timeline).toBe(true);
    expect(overlay.slice).toBe(true);
    expect(overlay.command).toBe(true);
  });

  it("parses filters without timeline support", () => {
    const concat = filters.find((f) => f.name === "concat")!;
    expect(concat.timeline).toBe(false);
  });

  it("extracts all required filters", () => {
    const names = filters.map((f) => f.name);
    expect(names).toContain("scale");
    expect(names).toContain("overlay");
    expect(names).toContain("loudnorm");
    expect(names).toContain("amix");
    expect(names).toContain("aresample");
  });
});
