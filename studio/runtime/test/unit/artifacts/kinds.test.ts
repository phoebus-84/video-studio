// ---------------------------------------------------------------------------
// Artifact kind mapping tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { contractToKind, isKnownKind, CONTRACT_KIND_MAP } from "../../../src/artifacts/kinds.js";

describe("contractToKind", () => {
  it("maps .md → markdown", () => {
    expect(contractToKind("script.md")).toBe("markdown");
  });

  it("maps .json → json", () => {
    expect(contractToKind("config.json")).toBe("json");
  });

  it("maps .wav → audio", () => {
    expect(contractToKind("narration.wav")).toBe("audio");
  });

  it("maps .mp3 → audio", () => {
    expect(contractToKind("voice.mp3")).toBe("audio");
  });

  it("maps .mp4 → video", () => {
    expect(contractToKind("output.mp4")).toBe("video");
  });

  it("maps .srt → captions", () => {
    expect(contractToKind("captions.srt")).toBe("captions");
  });

  it("maps .vtt → captions", () => {
    expect(contractToKind("subtitles.vtt")).toBe("captions");
  });

  it("maps .png → image", () => {
    expect(contractToKind("icon.png")).toBe("image");
  });

  it("maps .jpg → image", () => {
    expect(contractToKind("photo.jpg")).toBe("image");
  });

  it("maps .jpeg → image", () => {
    expect(contractToKind("photo.jpeg")).toBe("image");
  });

  it("maps .tape → tape", () => {
    expect(contractToKind("recording.tape")).toBe("tape");
  });

  it("maps trailing / → directory", () => {
    expect(contractToKind("illustrations/")).toBe("directory");
  });

  it("maps .yaml → yaml", () => {
    expect(contractToKind("pipeline.yaml")).toBe("yaml");
  });

  it("returns unknown for unrecognized extensions", () => {
    expect(contractToKind("data.xyz")).toBe("unknown");
    expect(contractToKind("file.bin")).toBe("unknown");
  });

  it("returns unknown for no extension", () => {
    expect(contractToKind("README")).toBe("unknown");
  });

  // Regression: no duplicated .tape branch
  it("has no duplicate entries in CONTRACT_KIND_MAP", () => {
    const extensions = Object.keys(CONTRACT_KIND_MAP);
    const unique = new Set(extensions);
    expect(extensions.length).toBe(unique.size);
  });
});

describe("isKnownKind", () => {
  it("returns true for canonical kinds", () => {
    expect(isKnownKind("markdown")).toBe(true);
    expect(isKnownKind("json")).toBe(true);
    expect(isKnownKind("yaml")).toBe(true);
    expect(isKnownKind("audio")).toBe(true);
    expect(isKnownKind("video")).toBe(true);
    expect(isKnownKind("image")).toBe(true);
    expect(isKnownKind("captions")).toBe(true);
    expect(isKnownKind("tape")).toBe(true);
    expect(isKnownKind("directory")).toBe(true);
  });

  it("returns false for unknown kinds", () => {
    expect(isKnownKind("unknown")).toBe(false);
    expect(isKnownKind("text/html")).toBe(false);
  });
});
