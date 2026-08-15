import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { buildBudgetReport } from "../src/routes/budget.js";

const TMP = resolve(".test-tmp/budget");
const REF = { channel: "acme", series: "s1", episode: "ep-01" };

const episodeDir = join(TMP, "acme", "series", "s1", "episodes", "ep-01");
const seriesDir = join(TMP, "acme", "series", "s1");
const channelDir = join(TMP, "acme");

/**
 * This endpoint used to answer with a fixed $5 limit and zero spend for every
 * episode, whatever had been generated. In a system whose premise is that
 * nothing is fabricated, an invented spend figure is the worst thing to make
 * up: it is the number someone would trust to decide whether to keep going.
 */
describe("budget", () => {
  const writeManifest = (attempts: Array<Record<string, unknown>>) =>
    fs.writeFile(
      join(episodeDir, "assets", "manifest.json"),
      JSON.stringify({ assets: [{ sceneId: "s1", sceneTitle: "One", attempts }] }),
    );

  const writeSettings = (dir: string, budget: unknown) =>
    fs.writeFile(join(dir, "settings.yaml"), `budget:\n${
      Object.entries(budget as Record<string, unknown>)
        .map(([k, v]) => `  ${k}: ${typeof v === "string" ? `"${v}"` : v}`)
        .join("\n")
    }\n`);

  beforeEach(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
    await fs.mkdir(join(episodeDir, "assets"), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it("reports no budget rather than inventing one", async () => {
    const report = await buildBudgetReport(TMP, REF);
    expect(report.limitMicros).toBeNull();
    expect(report.remainingMicros).toBeNull();
    expect(report.sources.limitFrom).toBeNull();
    expect(report.exhausted).toBe(false);
  });

  it("sums recorded spend from the asset manifest", async () => {
    await writeManifest([
      { id: "a", cost: { currency: "USD", micros: 4000 } },
      { id: "b", cost: { currency: "USD", micros: 3500 } },
    ]);

    const report = await buildBudgetReport(TMP, REF);
    expect(report.consumedMicros).toBe(7500);
    expect(report.sources.costedAttempts).toBe(2);
    expect(report.currency).toBe("USD");
  });

  it("counts attempts with no recorded cost separately, because unknown is not zero", async () => {
    await writeManifest([
      { id: "a", cost: { currency: "USD", micros: 4000 } },
      { id: "b" },
      { id: "c" },
    ]);

    const report = await buildBudgetReport(TMP, REF);
    expect(report.consumedMicros).toBe(4000);
    expect(report.sources.costedAttempts).toBe(1);
    expect(report.sources.uncostedAttempts).toBe(2);
  });

  it("takes the limit from the episode when it sets one", async () => {
    await writeSettings(episodeDir, { currency: "USD", limitMicros: 2_000_000 });
    await writeManifest([{ id: "a", cost: { currency: "USD", micros: 500_000 } }]);

    const report = await buildBudgetReport(TMP, REF);
    expect(report.limitMicros).toBe(2_000_000);
    expect(report.remainingMicros).toBe(1_500_000);
    expect(report.sources.limitFrom).toBe("episode");
  });

  it("inherits the limit from the series, then the channel", async () => {
    await fs.mkdir(seriesDir, { recursive: true });
    await writeSettings(seriesDir, { currency: "USD", limitMicros: 9_000_000 });

    let report = await buildBudgetReport(TMP, REF);
    expect(report.limitMicros).toBe(9_000_000);
    expect(report.sources.limitFrom).toBe("series");

    await fs.rm(join(seriesDir, "settings.yaml"));
    await fs.mkdir(channelDir, { recursive: true });
    await writeSettings(channelDir, { currency: "USD", limitMicros: 1_000_000 });

    report = await buildBudgetReport(TMP, REF);
    expect(report.limitMicros).toBe(1_000_000);
    expect(report.sources.limitFrom).toBe("channel");
  });

  it("the nearest declaration wins", async () => {
    await fs.mkdir(channelDir, { recursive: true });
    await writeSettings(channelDir, { currency: "USD", limitMicros: 9_000_000 });
    await writeSettings(episodeDir, { currency: "USD", limitMicros: 100_000 });

    const report = await buildBudgetReport(TMP, REF);
    expect(report.limitMicros).toBe(100_000);
    expect(report.sources.limitFrom).toBe("episode");
  });

  it("flags a warning threshold and exhaustion", async () => {
    await writeSettings(episodeDir, {
      currency: "USD",
      limitMicros: 1_000_000,
      warnAtMicros: 500_000,
    });
    await writeManifest([{ id: "a", cost: { currency: "USD", micros: 600_000 } }]);

    let report = await buildBudgetReport(TMP, REF);
    expect(report.warn).toBe(true);
    expect(report.exhausted).toBe(false);

    await writeManifest([{ id: "a", cost: { currency: "USD", micros: 1_200_000 } }]);
    report = await buildBudgetReport(TMP, REF);
    expect(report.exhausted).toBe(true);
    // Overspend is reported as negative, not clamped: hiding it would be the
    // same class of lie as inventing the figure.
    expect(report.remainingMicros).toBe(-200_000);
  });

  it("reports mixed currencies instead of summing meaningless totals", async () => {
    await writeManifest([
      { id: "a", cost: { currency: "USD", micros: 4000 } },
      { id: "b", cost: { currency: "EUR", micros: 4000 } },
    ]);

    const report = await buildBudgetReport(TMP, REF);
    expect(report.sources.mixedCurrencies).toEqual(expect.arrayContaining(["USD", "EUR"]));
  });

  it("reports zero spend for an episode that has generated nothing", async () => {
    const report = await buildBudgetReport(TMP, REF);
    expect(report.consumedMicros).toBe(0);
    expect(report.sources.costedAttempts).toBe(0);
  });
});
