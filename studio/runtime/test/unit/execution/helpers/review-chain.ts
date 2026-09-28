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
 * A fourth stage, `skilled`, depends only on `upstream` and declares
 * `review: skill` — avg-qr4.3's other review level, which an agent's own
 * approval satisfies. It is a sibling of `gated`, not downstream of it, so a
 * test exercising it does not also have to clear `gated`'s human review.
 *
 * A fifth, `attended`, depends only on `upstream` and declares
 * `autopilot: false` with `review: none` — avg-qr4.3's attendance gate on its
 * own, undiluted by a review requirement. A sibling of `gated` and `skilled`,
 * not downstream of either, for the same reason those two are siblings of
 * each other.
 *
 * `roots` is the caller's cleanup list; the directory is pushed onto it so
 * the caller's own `afterEach` removes it.
 *
 * `fanOut` appends that many extra stages depending on `gated`, alongside
 * `downstream`. They exist so a caller can count how often one `status()`
 * asks the review gate about a single shared dependency: with a wide fan-in
 * the difference between "once per dependent" and "once per call" is visible
 * rather than theoretical.
 */
export async function reviewChainPipeline(roots: string[], fanOut = 0): Promise<string> {
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
      "    - id: skilled",
      '      name: "Skilled"',
      "      type: editorial",
      "      inputs:",
      "        - contract: upstream.md",
      '          version: "1.0.0"',
      "      outputs:",
      "        - contract: skilled.md",
      '          version: "1.0.0"',
      "      gates:",
      "        autopilot: true",
      "        review: skill",
      "        retry_on_failure: 0",
      "      depends_on:",
      "        - upstream",
      "",
      "    - id: attended",
      '      name: "Attended"',
      "      type: editorial",
      "      inputs:",
      "        - contract: upstream.md",
      '          version: "1.0.0"',
      "      outputs:",
      "        - contract: attended.md",
      '          version: "1.0.0"',
      "      gates:",
      "        autopilot: false",
      "        review: none",
      "        retry_on_failure: 0",
      "      depends_on:",
      "        - upstream",
      "",
      ...Array.from({ length: fanOut }, (_, i) => [
        `    - id: fan-${i + 1}`,
        `      name: "Fan ${i + 1}"`,
        "      type: editorial",
        "      inputs:",
        "        - contract: gated.md",
        '          version: "1.0.0"',
        "      outputs:",
        `        - contract: fan-${i + 1}.md`,
        '          version: "1.0.0"',
        "      gates:",
        "        autopilot: true",
        "        review: none",
        "        retry_on_failure: 0",
        "      depends_on:",
        "        - gated",
        "",
      ].join("\n")),
    ].join("\n"),
  );
  return dir;
}
