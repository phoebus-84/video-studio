import { describe, expect, it, vi } from "vitest";
import { runAutopilot } from "../src/runtime/executor.js";
import type { RuntimeClient } from "../src/runtime/client.js";

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
