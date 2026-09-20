// ---------------------------------------------------------------------------
// A synthetic pipeline for exercising the review gate
// ---------------------------------------------------------------------------
// Shared by review-gate.test.ts and status.test.ts, which must be asking the
// same question of the same shape: whether `status` and `run` agree is only
// meaningful if both are looking at one pipeline.
// ---------------------------------------------------------------------------

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Write a three-stage review chain to a fresh temp directory and return it.
 *
 * The real narrated-illustrated-video manifest cannot exercise most of these
 * properties: its only `review: human` stages are `script` and `compose`,
 * both of which declare `autopilot: false`, and `terminal-recordings`,
 * `illustrations` and `qa` all sit behind `script` and so cannot be reached
 * by running. A synthetic three-stage chain gives exactly the shape this
 * suite needs: one ungated stage, a `review: human` stage depending on it,
 * and a third stage depending on that — the last of which is what lets a
 * dependency's declared review block a dependent two levels down without
 * tripping the autopilot gate.
 *
 * `roots` is the caller's cleanup list; the directory is pushed onto it so
 * the caller's own `afterEach` removes it.
 */
export async function reviewChainPipeline(roots: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "review-gate-pipeline-"));
  roots.push(dir);
  await writeFile(
    join(dir, "review-chain.yaml"),
    [
      "pipeline:",
      "  id: review-chain",
      '  version: "1.0.0"',
      "  stages:",
      "    - id: upstream",
      '      name: "Upstream"',
      "      type: editorial",
      "      outputs:",
      "        - contract: upstream.md",
      '          version: "1.0.0"',
      "      gates:",
      "        autopilot: true",
      "        review: none",
      "        retry_on_failure: 0",
      "      depends_on: []",
      "",
      "    - id: gated",
      '      name: "Gated"',
      "      type: editorial",
      "      inputs:",
      "        - contract: upstream.md",
      '          version: "1.0.0"',
      "      outputs:",
      "        - contract: gated.md",
      '          version: "1.0.0"',
      "      gates:",
      "        autopilot: true",
      "        review: human",
      "        retry_on_failure: 0",
      "      depends_on:",
      "        - upstream",
      "",
      "    - id: downstream",
      '      name: "Downstream"',
      "      type: editorial",
      "      inputs:",
      "        - contract: gated.md",
      '          version: "1.0.0"',
      "      outputs:",
      "        - contract: downstream.md",
      '          version: "1.0.0"',
      "      gates:",
      "        autopilot: true",
      "        review: none",
      "        retry_on_failure: 0",
      "      depends_on:",
      "        - gated",
      "",
    ].join("\n"),
  );
  return dir;
}
