// ---------------------------------------------------------------------------
// The studio's stage evidence (avg-qwc)
// ---------------------------------------------------------------------------
// A spec-driven series episode is made with the studio's tools, which write
// files: its stages are read from them (@studio/episode's
// seriesStageEvidence). The gateway and `vpr` compose this into their
// execution service; the runtime knows no episode format.
// ---------------------------------------------------------------------------

import { isSpecDriven, SERIES_STAGES, seriesStageEvidence } from "@studio/episode";
import type { StageEvidence } from "@studio/runtime";

export function createStudioStageEvidence(): StageEvidence {
  return {
    // Only for the series-production stages: another pipeline run on the same
    // episode, or a series that adds stages of its own, keeps the journal.
    appliesTo: ({ episodeDir, stageIds }) =>
      isSpecDriven(episodeDir) && stageIds.every((id) => (SERIES_STAGES as readonly string[]).includes(id)),
    stages: async ({ ref, episodeDir, operatorKey }) =>
      seriesStageEvidence(episodeDir, { episodeRef: ref, key: operatorKey }) ?? {},
  };
}
