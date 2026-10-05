// ---------------------------------------------------------------------------
// Policy tests — gates (the budget is contracts' spend ledger, avg-91o)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  checkGate,
  checkGates,
  detectDowngrade,
  PolicyError,
} from "../../../src/policy/index.js";
import type { PolicyGate } from "../../../src/policy/types.js";

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
