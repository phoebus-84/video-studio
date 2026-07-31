import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalNarrationPath } from "../src/capability-tools.js";

function episode(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-narration-"));
  mkdirSync(join(root, "artifacts", "narration"), { recursive: true });
  return root;
}

describe("Pi canonical narration composition input", () => {
  it("prefers canonical final WAV for camelCase and worker snake_case", () => {
    for (const field of ["finalWav", "final_wav"]) {
      const root = episode();
      const relative = "artifacts/narration/mastered.wav";
      writeFileSync(join(root, relative), "wav-fixture");
      writeFileSync(
        join(root, "artifacts", "narration", "narration-manifest.json"),
        JSON.stringify({ [field]: { path: relative } }),
      );
      expect(canonicalNarrationPath(root)).toBe(join(root, relative));
    }
  });

  it("returns null only when canonical manifest is absent", () => {
    expect(canonicalNarrationPath(episode())).toBeNull();
  });

  it("fails closed when canonical final output is missing", () => {
    const root = episode();
    writeFileSync(
      join(root, "artifacts", "narration", "narration-manifest.json"),
      JSON.stringify({ finalWav: { path: "artifacts/narration/missing.wav" } }),
    );
    expect(() => canonicalNarrationPath(root)).toThrow("final WAV is missing");
  });
});
