// ---------------------------------------------------------------------------
// pva_generate_flux3_max_video: FLUX 3 Max on fal, through the spend ledger
// ---------------------------------------------------------------------------
// The real tool against a stubbed `fetch`: fal's pricing API, its queue
// (submit, status, result) and the CDN are all fakes, so nothing leaves the
// machine and nothing is spent.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFlux3MaxTools, FLUX3_MAX_TEXT_ENDPOINT_ID, FLUX3_MAX_IMAGE_ENDPOINT_ID } from "../src/flux3-max-tools.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";

const CHANNEL = "ambient-through-time";
const SERIES = "luoghi-del-passato";
const EPISODE = "ep";
const PNG = Buffer.from("89504e470d0a1a0a-fake-png", "utf-8");

interface Tool {
  name: string;
  execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
}

describe("pva_generate_flux3_max_video", () => {
  let root: string;
  let dir: string;
  let previous: { root?: string; fal?: string };
  let fetchMock: ReturnType<typeof vi.fn>;
  let tool: Tool;
  let submittedTo: string | undefined;
  let submitted: Record<string, unknown> | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-flux3-"));
    dir = join(root, CHANNEL, "series", SERIES, "episodes", EPISODE);
    mkdirSync(join(dir, "journal"), { recursive: true });
    mkdirSync(join(dir, "assets", "crops"), { recursive: true });
    writeFileSync(join(dir, "assets", "crops", "start.png"), PNG);
    previous = { root: process.env.AVG_LIBRARY_ROOT, fal: process.env.FAL_KEY };
    process.env.AVG_LIBRARY_ROOT = root;
    process.env.FAL_KEY = "fal-key-for-tests";
    submittedTo = undefined;
    submitted = undefined;

    fetchMock = vi.fn(async (input: string | URL, init?: { method?: string; body?: string }) => {
      const url = String(input);
      if (url.startsWith("https://api.fal.ai/v1/models/pricing")) {
        const endpoint = new URL(url).searchParams.get("endpoint_id");
        return Response.json({ prices: [{ endpoint_id: endpoint, unit_price: 0.02125, unit: "seconds", currency: "USD" }] });
      }
      const queue = [FLUX3_MAX_TEXT_ENDPOINT_ID, FLUX3_MAX_IMAGE_ENDPOINT_ID].find((e) => url === `https://queue.fal.run/${e}`);
      if (queue && init?.method === "POST") {
        submittedTo = queue;
        submitted = JSON.parse(init.body!);
        return Response.json({
          request_id: "req-flux",
          status_url: `https://queue.fal.run/${queue}/requests/req-flux/status`,
          response_url: `https://queue.fal.run/${queue}/requests/req-flux`,
        });
      }
      if (url.endsWith("/requests/req-flux/status")) return Response.json({ status: "COMPLETED" });
      if (url.endsWith("/requests/req-flux")) {
        return Response.json({ video: { url: "https://cdn.example/flux.mp4", content_type: "video/mp4" }, seed: 7 });
      }
      if (url === "https://cdn.example/flux.mp4") return new Response(Buffer.from("mp4 bytes"), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tools: Tool[] = [];
    registerFlux3MaxTools({ registerTool: (t: Tool) => tools.push(t) } as never);
    tool = tools.find((t) => t.name === "pva_generate_flux3_max_video")!;
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
  const journal = () => existsSync(join(dir, JOURNAL_RELATIVE_PATH))
    ? parseJournal(readFileSync(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"))
    : [];
  const generate = (extra: Record<string, unknown> = {}) => tool.execute("call-1", {
    channel: CHANNEL, series: SERIES, episode: EPISODE, name: "clip",
    prompt: "a slow dolly through the ruins", durationSeconds: 5, ...extra,
  }, undefined, undefined, {});
  const clipDir = () => join(dir, "assets", "video", "flux-3-max");

  it("generates text to video at the live price, reserved and settled on the ledger", async () => {
    budget(1_000_000);
    const result = await generate({ seed: 11 });
    expect(submittedTo).toBe(FLUX3_MAX_TEXT_ENDPOINT_ID);
    expect(submitted).toMatchObject({ prompt: "a slow dolly through the ruins", duration: 5, resolution: "720p", seed: 11 });
    expect(submitted).not.toHaveProperty("image_url");
    expect(readFileSync(join(clipDir(), "clip.mp4"), "utf-8")).toBe("mp4 bytes");
    const provenance = JSON.parse(readFileSync(join(clipDir(), "clip.provenance.json"), "utf-8"));
    expect(provenance).toMatchObject({ mode: "text-to-video", providerRequestId: "req-flux", billingUnits: 10, seed: 11 });
    // 5 s × 2 billing seconds × $0.02125
    expect(journal().map((e) => e.type)).toEqual(["spend-reserved", "spend-settled"]);
    expect(journal()[0]!.data).toMatchObject({ capability: "video.generate", estimate: { currency: "USD", micros: 212_500 } });
    expect(result.details).toMatchObject({ seed: 11 });
  });

  it("sends the opening image for image to video", async () => {
    budget(1_000_000);
    await generate({ imagePath: "assets/crops/start.png" });
    expect(submittedTo).toBe(FLUX3_MAX_IMAGE_ENDPOINT_ID);
    expect(String(submitted!.image_url)).toMatch(/^data:image\/png;base64,/);
  });

  it("refuses an episode outside the library before any request, without writing", async () => {
    for (const escape of [{ channel: "../escaped" }, { series: "../../x" }, { episode: ".." }]) {
      await expect(generate(escape)).rejects.toThrow(/Invalid component/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readdirSync(root).sort()).toEqual([CHANNEL]);
  });

  it("never replaces a clip: a taken name is refused before spending", async () => {
    mkdirSync(clipDir(), { recursive: true });
    writeFileSync(join(clipDir(), "clip.mp4"), "old");
    await expect(generate({ overwrite: true })).rejects.toThrow(/already exists/);
    expect(readFileSync(join(clipDir(), "clip.mp4"), "utf-8")).toBe("old");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes the name before spending: the same name twice at once draws once", async () => {
    budget(1_000_000);
    const outcomes = await Promise.allSettled([generate(), generate()]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(String((outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/already exists/);
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith("https://queue.fal.run/") && init?.method === "POST")).toHaveLength(1);
  });

  it("frees the name when fal refuses, and releases the reservation", async () => {
    budget(1_000_000);
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.fal.ai/v1/models/pricing")) {
        return Response.json({ prices: [{ endpoint_id: FLUX3_MAX_TEXT_ENDPOINT_ID, unit_price: 0.02125, unit: "seconds", currency: "USD" }] });
      }
      return Response.json({ detail: "bad prompt" }, { status: 422 });
    });
    await expect(generate()).rejects.toThrow();
    expect(journal().map((e) => e.type)).toEqual(["spend-reserved", "spend-released"]);
    expect(existsSync(join(clipDir(), "clip.mp4"))).toBe(false);
  });
});
