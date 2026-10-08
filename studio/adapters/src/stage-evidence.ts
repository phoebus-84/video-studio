// ---------------------------------------------------------------------------
// The studio's stage evidence (avg-qwc)
// ---------------------------------------------------------------------------
// A spec-driven series episode is made with the studio's tools, which write
// files: its stages are read from them (@studio/episode's
// seriesStageEvidence). The gateway and `vpr` compose this into their
// execution service; the runtime knows no episode format.
// ---------------------------------------------------------------------------

import { isSpecDriven, seriesStageEvidence } from "@studio/episode";
import type { StageEvidence } from "@studio/runtime";

export function createStudioStageEvidence(): StageEvidence {
  return {
    appliesTo: ({ episodeDir }) => isSpecDriven(episodeDir),
    stages: async ({ ref, episodeDir, operatorKey }) =>
      seriesStageEvidence(episodeDir, { episodeRef: ref, key: operatorKey }) ?? {},
  };
}
