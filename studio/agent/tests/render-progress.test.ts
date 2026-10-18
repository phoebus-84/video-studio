// pva_compose_video streams a progress bar: one line every 2%, with
// the time taken and an estimate of what is left.

import { describe, expect, it } from "vitest";
import { renderProgressBar } from "../src/render-progress.js";

describe("renderProgressBar", () => {
  it("draws the bar, the percentage, the time taken and the time left", () => {
    const bar = renderProgressBar(0);
    expect(bar(0, 0)).toBe("Rendering [░░░░░░░░░░░░░░░░░░░░] 0% · 0s");
    expect(bar(0.5, 60_000)).toBe("Rendering [██████████░░░░░░░░░░] 50% · 1m00s · ~1m00s left");
    expect(bar(1, 240_000)).toBe("Rendering [████████████████████] 100% · 4m00s");
  });

  it("writes one line every 2%", () => {
    const bar = renderProgressBar(0);
    expect(bar(0.101, 1000)).not.toBeNull();
    expect(bar(0.104, 1100)).toBeNull();
    expect(bar(0.11, 1200)).toBeNull();
    expect(bar(0.12, 1300)).not.toBeNull();
  });

  it("estimates from the first report, not from segments the cache gave at once", () => {
    const bar = renderProgressBar(0);
    bar(0.5, 1000);
    expect(bar(0.76, 61_000)).toBe("Rendering [███████████████░░░░░] 76% · 1m01s · ~55s left");
  });
});
