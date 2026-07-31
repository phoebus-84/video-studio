import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadNarrationManifest, naturalSceneOrder } from "../src/runtime/narration-manifest.js";

async function episode(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-narration-"));
  await fs.mkdir(path.join(root, "artifacts", "narration"), { recursive: true });
  return root;
}

describe("canonical narration migration reader", () => {
  it("preserves manifest order and accepts worker snake_case during migration", async () => {
    const root = await episode();
    await fs.writeFile(path.join(root, "artifacts", "narration", "narration-manifest.json"), JSON.stringify({
      entries: [
        { segment_id: "s10", accepted_attempt_id: "attempt-10", wav: { path: "artifacts/narration/s10.wav", duration_seconds: 2.5 }, pause_after_ms: 300 },
        { segment_id: "s2", accepted_attempt_id: "attempt-2", wav: { path: "artifacts/narration/s2.wav", duration_seconds: 1.25 }, pause_after_ms: 0 },
      ],
      final_wav: { path: "artifacts/narration/narration-full.wav" },
    }));
    const loaded = await loadNarrationManifest(root);
    expect(loaded?.source).toBe("canonical");
    expect(loaded?.entries.map((entry) => entry.segmentId)).toEqual(["s10", "s2"]);
    expect(loaded?.entries[0]).toMatchObject({ durationSeconds: 2.5, pauseAfterMs: 300, acceptedAttemptId: "attempt-10" });
    expect(loaded?.finalWavPath).toBe("artifacts/narration/narration-full.wav");
  });

  it("reads canonical camelCase caption text", async () => {
    const root = await episode();
    await fs.writeFile(path.join(root, "artifacts", "narration", "narration-manifest.json"), JSON.stringify({
      entries: [{ segmentId: "seg-a", wav: { path: "a.wav", durationSeconds: 1 }, pauseAfterMs: 0 }],
      captions: [{ segmentId: "seg-a", index: 1, startSeconds: 0, endSeconds: 1, text: "Exact caption" }],
    }));
    const loaded = await loadNarrationManifest(root);
    expect(loaded?.entries[0]?.text).toBe("Exact caption");
  });

  it("natural legacy ordering avoids s10 before s2", () => {
    expect(["s10.wav", "s2.wav", "s1.wav"].sort(naturalSceneOrder)).toEqual(["s1.wav", "s2.wav", "s10.wav"]);
  });
});
