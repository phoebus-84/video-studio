import { describe, expect, it } from "vitest";
import { normalizeEpisodeStatus } from "../src/context.js";

describe("episode context normalization", () => {
  it("accepts the gateway episode-detail shape", () => {
    const normalized = normalizeEpisodeStatus({
      pipeline: "wordless-rigged-short",
      stages: [
        { id: "visual-beats", status: "completed" },
        { id: "qa", status: "pending" },
      ],
      blockers: [],
    });
    expect(normalized.pipeline.name).toBe("wordless-rigged-short");
    expect(normalized.stages.map((stage) => stage.state)).toEqual(["completed", "pending"]);
    expect(normalized.hasBlockers).toBe(false);
  });

  it("continues to accept the legacy nested pipeline shape", () => {
    const normalized = normalizeEpisodeStatus({
      pipeline: { name: "legacy", version: 3 },
      stages: [{ id: "brief", state: "completed" }],
      blockers: ["review"],
    });
    expect(normalized.pipeline).toEqual({ name: "legacy", version: 3 });
    expect(normalized.stages[0]?.state).toBe("completed");
    expect(normalized.hasBlockers).toBe(true);
  });
});
