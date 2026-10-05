// ---------------------------------------------------------------------------
// Paid tools go through the spend ledger (avg-91o)
// ---------------------------------------------------------------------------
// `pva_generate_image` used to POST to fal.run with nothing recorded and
// nothing to stop it. These run the real tool against a stubbed `fetch` and
// read the episode's journal: the call is reserved before the request and
// settled after, and a call the budget cannot cover never reaches fal.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCapabilityTools } from "../src/capability-tools.js";
import { falEstimate, providerCost } from "../src/spend.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";

const CHANNEL = "childrens";
const SERIES = "fairy-tales";
const EPISODE = "ep";

interface Tool {
  name: string;
  execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

describe("falEstimate", () => {
  it("prices a model from its profile, by endpoint or profile id", () => {
    expect(falEstimate("fal-ai/flux/dev")).toEqual({
      estimate: { currency: "USD", micros: 5_000 }, priced: true, profile: "fal-ai/flux/dev@v1",
    });
    expect(falEstimate("minimax/h3/image-to-video@v1").estimate.micros).toBe(480_000);
  });

  it("says when nobody knows what a model costs", () => {
    expect(falEstimate("fal-ai/someone-elses-model")).toMatchObject({ priced: false, estimate: { micros: 0 } });
  });
});

describe("providerCost", () => {
  it("turns fal's amount into ledger money, and nothing into null", () => {
    expect(providerCost({ amount: 0.48, currency: "USD" })).toEqual({ currency: "USD", micros: 480_000 });
    expect(providerCost(null)).toBeNull();
  });
});

describe("pva_generate_image on the ledger", () => {
  let root: string;
  let dir: string;
  let previous: { root?: string; fal?: string };
  let fetchMock: ReturnType<typeof vi.fn>;
  let tool: Tool;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-spend-"));
    dir = join(root, CHANNEL, "series", SERIES, "episodes", EPISODE);
    mkdirSync(join(dir, "journal"), { recursive: true });
    previous = { root: process.env.AVG_LIBRARY_ROOT, fal: process.env.FAL_KEY };
    process.env.AVG_LIBRARY_ROOT = root;
    process.env.FAL_KEY = "fal-key-for-tests";

    fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://fal.run/")) {
        return new Response(JSON.stringify({ images: [{ url: "https://cdn.example/s1.jpg" }], seed: 7 }), { status: 200 });
      }
      return new Response(Buffer.from("jpeg bytes"), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tools: Tool[] = [];
    registerCapabilityTools({ registerTool: (t: Tool) => tools.push(t) } as never);
    tool = tools.find((t) => t.name === "pva_generate_image")!;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previous.root === undefined) delete process.env.AVG_LIBRARY_ROOT; else process.env.AVG_LIBRARY_ROOT = previous.root;
    if (previous.fal === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previous.fal;
    rmSync(root, { recursive: true, force: true });
  });

  const budget = (limitMicros: number) => writeFileSync(
    join(root, CHANNEL, "series", SERIES, "settings.yaml"),
    `budget:\n  currency: USD\n  limitMicros: ${limitMicros}\n`,
  );
  const generate = () => tool.execute("call-1", {
    channel: CHANNEL, series: SERIES, episode: EPISODE, sceneId: "s1", prompt: "a wolf at the door",
  }, undefined, undefined, {});
  const journal = () => existsSync(join(dir, JOURNAL_RELATIVE_PATH))
    ? parseJournal(readFileSync(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"))
    : [];

  it("reserves before the request and settles at the estimate after", async () => {
    budget(1_000_000);
    const result = await generate();
    expect(result.isError).toBeFalsy();
    expect(existsSync(join(dir, "assets", "images", "s1.jpg"))).toBe(true);

    const events = journal();
    expect(events.map((e) => e.type)).toEqual(["spend-reserved", "spend-settled"]);
    expect(events[0]!.data).toMatchObject({
      capability: "image.generate", provider: "fal", profile: "fal-ai/flux/dev@v1",
      purpose: "image s1", estimate: { currency: "USD", micros: 5_000 },
    });
    // fal.run's synchronous answer carries no cost, so the estimate stands.
    expect(events[1]!.data).toMatchObject({ basis: "estimate", cost: { micros: 5_000 } });
  });

  it("never calls fal when the budget cannot cover the image", async () => {
    budget(4_000);
    const result = await generate();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/past its \$0\.004 budget/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
  });

  it("releases a call fal refused, so a bad request costs nothing", async () => {
    budget(1_000_000);
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ detail: "bad prompt" }), { status: 422 }));
    const result = await generate();
    expect(result.isError).toBe(true);
    expect(journal().map((e) => e.type)).toEqual(["spend-reserved", "spend-released"]);
  });

  it("keeps a call whose result could not be downloaded: fal did the work", async () => {
    budget(1_000_000);
    fetchMock.mockImplementation(async (url: string) => url.startsWith("https://fal.run/")
      ? new Response(JSON.stringify({ images: [{ url: "https://cdn.example/s1.jpg" }] }), { status: 200 })
      : new Response("gone", { status: 404 }));
    await generate();
    expect(journal().map((e) => e.type)).toEqual(["spend-reserved", "spend-settled"]);
  });

  it("records every call, uncapped, on an episode with no budget", async () => {
    const result = await generate();
    expect(result.isError).toBeFalsy();
    expect(journal().map((e) => e.type)).toEqual(["spend-reserved", "spend-settled"]);
  });
});
