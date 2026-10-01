import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StageAdapter } from "../descriptor.js";
import { loadNarrationManifest } from "../narration-manifest.js";
import { narrationEntries } from "./narration-segments.js";

/**
 * Per-segment start, end and pause, derived from the narration manifest by
 * fixed arithmetic. A derivation, not a provider call, so it performs the
 * editorial `timing` stage without requesting a capability.
 */
export const narrationTiming: StageAdapter = {
  id: "narration-timing",
  summary: "Derives timing.json from the narration manifest's measured segment durations and pauses",
  capability: null,
  provider: "studio",
  produces: ["timing.json"],
  consumes: ["narration-manifest.json"],
  requires: {},
  async perform(ctx) {
    const timingPath = path.join(ctx.episodeDir, "artifacts", "timing.json");
    try {
      const entries = await narrationEntries(ctx, []);
      let timeline = 0;
      const segments = entries.map((entry) => {
        const startSec = timeline;
        const endSec = startSec + entry.durationSeconds;
        timeline = endSec + entry.pauseAfterMs / 1000;
        return {
          id: entry.segmentId,
          acceptedAttemptId: entry.acceptedAttemptId,
          startSec,
          endSec,
          durationSec: entry.durationSeconds,
          pauseAfterSec: entry.pauseAfterMs / 1000,
        };
      });
      const timing = {
        source: (await loadNarrationManifest(ctx.episodeDir)) ? "narration-manifest" : "legacy-sidecars",
        totalDurationSec: timeline,
        segments,
        transitionSec: 0.5,
        fps: 30,
      };
      await fs.writeFile(timingPath, JSON.stringify(timing, null, 2));
      ctx.log(`  timing: ${segments.length} manifest-ordered segments, ${timeline.toFixed(1)}s total`);
      return [timingPath];
    } catch (err) {
      ctx.log(`  timing: error — ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  },
};
