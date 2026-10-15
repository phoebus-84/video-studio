// pva_compose_video streams a progress bar: one line per whole percent, with
// the time taken and an estimate of what is left.

import { describe, expect, it } from "vitest";
import { renderProgressBar } from "../src/render-progress.js";

describe("renderProgressBar", () => {
  it("draws the bar, the percentage, the time taken and the time left", () => {
    const bar = renderProgressBar(0);
    expect(bar(0, 0)).toBe("Rendering [░░░░░░░░░░░░░░░░░░░░] 0% · 0s");
    expect(bar(0.25, 60_000)).toBe("Rendering [█████░░░░░░░░░░░░░░░] 25% · 1m00s · ~3m00s left");
    expect(bar(1, 240_000)).toBe("Rendering [████████████████████] 100% · 4m00s");
  });

  it("writes one line per whole percent", () => {
    const bar = renderProgressBar(0);
    expect(bar(0.101, 1000)).not.toBeNull();
    expect(bar(0.104, 1100)).toBeNull();
    expect(bar(0.11, 1200)).not.toBeNull();
  });

  it("estimates from the first report, not from segments the cache gave at once", () => {
    const bar = renderProgressBar(0);
    bar(0.5, 1000);
    expect(bar(0.75, 61_000)).toBe("Rendering [███████████████░░░░░] 75% · 1m01s · ~1m00s left");
  });
});
