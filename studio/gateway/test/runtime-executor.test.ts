import { describe, expect, it, vi } from "vitest";
import { runAutopilot, HANDLERS } from "../src/runtime/executor.js";
import type { RuntimeClient } from "../src/runtime/client.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("runAutopilot", () => {
  it("reports a fully materialized custom pipeline without invoking handlers", async () => {
    const runtime = {
      run: vi.fn().mockResolvedValue({ ok: true, data: { message: "All stages complete", completed: true } }),
    } as unknown as RuntimeClient;
    const messages: string[] = [];

    const report = await runAutopilot(
      runtime,
      { channel: "wordless-comedy", series: "give-me-time", episode: "the-run-up" },
      "wordless-rigged-short",
      "/tmp/library",
      (message) => messages.push(message),
    );

    expect(report.stages).toEqual([]);
    expect(report.summary).toMatch(/^All stages already complete/);
    expect(messages).toContain("Autopilot: all stages complete!");
  });
});

describe("fabricated reviews", () => {
  // handleSafetyReview wrote findings about a wolf eating characters, and
  // handleContinuityCheck wrote "scenes: 8" with four passing checks. Neither
  // opened a single file belonging to the episode it reported on, so every
  // episode got the same text.
  it("registers no handler that invents a review", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(["captions", "illustrations", "qa", "timing"]);
    expect(HANDLERS["safety-review"]).toBeUndefined();
    expect(HANDLERS["continuity-check"]).toBeUndefined();
  });

  it("keeps the fabricated report in fixtures only", () => {
    const fixture = readFileSync(join(__dirname, "fixtures/fabricated-safety-report.json"), "utf-8");
    expect(fixture).toContain("Wolf eating characters");

    const source = readFileSync(join(__dirname, "../src/runtime/executor.ts"), "utf-8");
    expect(source).not.toContain("Wolf eating characters");
    expect(source).not.toContain("Consistent lighting direction");
  });
});
