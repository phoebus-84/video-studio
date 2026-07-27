// ---------------------------------------------------------------------------
// Policy tests — gates and budget
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  checkGate,
  checkGates,
  detectDowngrade,
  PolicyError,
  createLedger,
  reserveBudget,
  consumeReserve,
  releaseReserve,
  BudgetError,
} from "../../../src/policy/index.js";
import type { PolicyGate, BudgetLedger } from "../../../src/policy/types.js";
import type { ApprovalMode } from "../../../src/settings/types.js";

// ── Gate fixtures ────────────────────────────────────────────────────────────

const HARD_GATE: PolicyGate = {
  gateId: "script:language-check",
  stageId: "script",
  description: "Script must be child-appropriate",
  hard: true,
};

const SOFT_GATE: PolicyGate = {
  gateId: "render:qa",
  stageId: "render",
  description: "QA check for render artifacts",
  hard: false,
};

// ── Gate tests ───────────────────────────────────────────────────────────────

describe("checkGate", () => {
  it("autopilot blocks hard gate", () => {
    const result = checkGate(HARD_GATE, "autopilot");
    expect(result.decision).toBe("block");
  });

  it("autopilot proceeds through soft gate", () => {
    const result = checkGate(SOFT_GATE, "autopilot");
    expect(result.decision).toBe("proceed");
  });

  it("guided prompts on soft gate", () => {
    const result = checkGate(SOFT_GATE, "guided");
    expect(result.decision).toBe("prompt");
  });

  it("guided blocks hard gate", () => {
    const result = checkGate(HARD_GATE, "guided");
    expect(result.decision).toBe("block");
  });

  it("manual prompts on all gates", () => {
    expect(checkGate(HARD_GATE, "manual").decision).toBe("prompt");
    expect(checkGate(SOFT_GATE, "manual").decision).toBe("prompt");
  });
});

describe("checkGates", () => {
  it("proceeds when all gates pass", () => {
    const result = checkGates([SOFT_GATE], "autopilot");
    expect(result.blocked).toBe(false);
  });

  it("throws PolicyError on hard block", () => {
    expect(() => checkGates([HARD_GATE, SOFT_GATE], "autopilot")).toThrow(
      PolicyError,
    );
  });

  it("throws on guided with hard gate", () => {
    expect(() => checkGates([HARD_GATE], "guided")).toThrow(PolicyError);
  });
});

describe("detectDowngrade", () => {
  it("detects downgrade from 1080p to 720p", () => {
    const result = detectDowngrade("youtube-1080p", "youtube-720p");
    expect(result.downgraded).toBe(true);
    expect(result.reason).toBeDefined();
  });

  it("allows upgrade", () => {
    const result = detectDowngrade("youtube-1080p", "youtube-4k");
    expect(result.downgraded).toBe(false);
  });

  it("allows same profile", () => {
    const result = detectDowngrade("youtube-1080p", "youtube-1080p");
    expect(result.downgraded).toBe(false);
  });
});

// ── Budget tests ─────────────────────────────────────────────────────────────

describe("BudgetLedger", () => {
  it("creates ledger with correct initial state", () => {
    const ledger = createLedger("ep-01", 10);
    expect(ledger.limit).toBe(10);
    expect(ledger.reserved).toBe(0);
    expect(ledger.spent).toBe(0);
    expect(ledger.available).toBe(10);
  });

  it("reserves budget correctly", () => {
    let ledger = createLedger("ep-01", 10);
    ledger = reserveBudget(ledger, "script", 3);
    expect(ledger.reserved).toBe(3);
    expect(ledger.available).toBe(7);
    expect(ledger.reserves.length).toBe(1);
    expect(ledger.reserves[0]!.estimatedCost).toBe(3);
  });

  it("prevents overspend via reserve", () => {
    const ledger = createLedger("ep-01", 10);
    expect(() => reserveBudget(ledger, "big-stage", 15)).toThrow(BudgetError);
  });

  it("consumes reserve with actual cost", () => {
    let ledger = createLedger("ep-01", 10);
    ledger = reserveBudget(ledger, "script", 3);
    ledger = consumeReserve(ledger, ledger.reserves[0]!.reserveId, 2.5);

    expect(ledger.reserved).toBe(0);
    expect(ledger.spent).toBe(2.5);
    expect(ledger.available).toBe(7.5);
    expect(ledger.reserves[0]!.consumed).toBe(true);
    expect(ledger.reserves[0]!.actualCost).toBe(2.5);
  });

  it("releases unconsumed reserve", () => {
    let ledger = createLedger("ep-01", 10);
    ledger = reserveBudget(ledger, "script", 3);
    ledger = reserveBudget(ledger, "narration", 2);
    ledger = releaseReserve(ledger, ledger.reserves[0]!.reserveId);

    expect(ledger.reserved).toBe(2);
    expect(ledger.available).toBe(8);
    expect(ledger.reserves.length).toBe(1);
  });

  it("rejects double consume", () => {
    let ledger = createLedger("ep-01", 10);
    ledger = reserveBudget(ledger, "script", 3);
    const id = ledger.reserves[0]!.reserveId;
    ledger = consumeReserve(ledger, id, 3);
    expect(() => consumeReserve(ledger, id, 3)).toThrow(BudgetError);
  });

  it("handles concurrent reservations within budget", () => {
    let ledger = createLedger("ep-01", 10);
    ledger = reserveBudget(ledger, "a", 4);
    ledger = reserveBudget(ledger, "b", 4);
    ledger = reserveBudget(ledger, "c", 2);
    expect(ledger.reserved).toBe(10);
    expect(ledger.available).toBe(0);

    // One more should fail
    expect(() => reserveBudget(ledger, "d", 1)).toThrow(BudgetError);
  });
});
