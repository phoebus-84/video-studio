// ---------------------------------------------------------------------------
// The gateway's review gate
// ---------------------------------------------------------------------------
// avg-qr4.1 bound a review to sha256 hashes of the artifacts it examined, so
// changing a reviewed artifact invalidates its review. This adapts that record
// to the port the execution service consults, moving the logic rather than
// rewriting it.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { ReviewGate } from "@studio/runtime";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { deriveGateState } from "@studio/contracts/src/gate-review.mjs";

export class GatewayReviewGate implements ReviewGate {
  async isOutstanding(
    stageId: string,
    episodeDir: string,
  ): Promise<{ outstanding: boolean; reason?: string }> {
    let events;
    try {
      const contents = await readFile(path.join(episodeDir, JOURNAL_RELATIVE_PATH), "utf-8");
      events = parseJournal(contents, { strict: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        // No journal at all means nothing has been reviewed or requested.
        return { outstanding: false };
      }
      // A journal that exists and cannot be read is not evidence of approval.
      return {
        outstanding: true,
        reason: `has a review that cannot be read: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const state = await deriveGateState(events, stageId, episodeDir);
    if (state.state === "requested") {
      return { outstanding: true, reason: "is awaiting review" };
    }
    if (state.state === "invalidated") {
      return { outstanding: true, reason: `has an invalidated review: ${state.reason}` };
    }
    return { outstanding: false };
  }
}
