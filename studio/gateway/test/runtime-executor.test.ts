import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedStage } from "@studio/runtime";
import { GatewayDispatcher } from "../src/runtime/dispatcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The only part of a ResolvedStage `canDispatch` looks at. */
function stageNamed(id: string): ResolvedStage {
  return { definition: { id } } as unknown as ResolvedStage;
}

describe("fabricated reviews", () => {
  // handleSafetyReview wrote findings about a wolf eating characters, and
  // handleContinuityCheck wrote "scenes: 8" with four passing checks. Neither
  // opened a single file belonging to the episode it reported on, so every
  // episode got the same text.
  //
  // The registry those two are absent from is no longer exported: HANDLERS is
  // module-private to dispatcher.ts. `canDispatch` is the same property
  // through the surviving surface, and it is the one the execution service
  // actually consults.
  it("registers no handler that invents a review", () => {
    const dispatcher = new GatewayDispatcher();
    expect(dispatcher.canDispatch(stageNamed("safety-review"))).toBe(false);
    expect(dispatcher.canDispatch(stageNamed("continuity-check"))).toBe(false);
  });

  it("dispatches exactly the four stages that do real work", () => {
    // The other half of "exactly four keys": the absences above would also
    // hold for a dispatcher that handled nothing at all.
    const dispatcher = new GatewayDispatcher();
    for (const id of ["illustrations", "captions", "timing", "qa"]) {
      expect(dispatcher.canDispatch(stageNamed(id))).toBe(true);
    }
  });

  it("does not mistake an inherited Object key for a registered handler", () => {
    // `id in HANDLERS` matched Object.prototype's keys, so a stage called
    // "toString" reported dispatchable while `dispatch` handed back a
    // prototype method. canDispatch and dispatch disagreeing is exactly what
    // inverts the service's blocked-versus-failed distinction.
    const dispatcher = new GatewayDispatcher();
    for (const id of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(dispatcher.canDispatch(stageNamed(id))).toBe(false);
    }
  });

  it("keeps the fabricated report in fixtures only", () => {
    const fixture = readFileSync(join(__dirname, "fixtures/fabricated-safety-report.json"), "utf-8");
    expect(fixture).toContain("Wolf eating characters");

    const source = readFileSync(join(__dirname, "../src/runtime/executor.ts"), "utf-8");
    expect(source).not.toContain("Wolf eating characters");
    expect(source).not.toContain("Consistent lighting direction");
  });

  it("leaves executor.ts holding no orchestration", () => {
    // What runs, in what order, under what lease, and whether the result
    // counted moved to the execution service. A handler file that grew any of
    // it back would be the same conflation returning.
    const source = readFileSync(join(__dirname, "../src/runtime/executor.ts"), "utf-8");
    for (const gone of ["runAutopilot", "HANDLERS", "approval-requested", "deriveGateState"]) {
      expect(source).not.toContain(gone);
    }
  });
});
