// ---------------------------------------------------------------------------
// pva_generate_wan_video: Wan 2.2 turbo on fal, through the spend ledger
// ---------------------------------------------------------------------------
// The real tool against a stubbed `fetch`: fal's queue (submit, status,
// result) and the CDN are all fakes, so nothing leaves the machine and
// nothing is spent.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerWanTools, wanClipPriceUsd, wanRequestBody } from "../src/wan-tools.js";
import { videoGenerationStatus } from "../src/capability-status.js";
import { falEstimate } from "../src/spend.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";

const CHANNEL = "ambient-through-time";
const SERIES = "luoghi-del-passato";
const EPISODE = "ep";
const ENDPOINT = "fal-ai/wan/v2.2-a14b/image-to-video/turbo";
const QUEUE = `https://queue.fal.run/${ENDPOINT}`;
const PNG = Buffer.from("89504e470d0a1a0a-fake-png", "utf-8");

interface Tool {
  name: string;
  execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
}

describe("wanRequestBody", () => {
  it("maps the tool's parameters onto fal's turbo schema", () => {
    expect(wanRequestBody({
      prompt: "flame flickers", imageDataUrl: "data:image/png;base64,AA", resolution: "580p",
      aspectRatio: "1:1", seed: 42, enablePromptExpansion: false, acceleration: "none", videoQuality: "maximum",
    })).toEqual({
      image_url: "data:image/png;base64,AA",
      prompt: "flame flickers",
      resolution: "580p",
      aspect_ratio: "1:1",
      seed: 42,
      enable_prompt_expansion: false,
      enable_safety_checker: true,
      acceleration: "none",
      video_quality: "maximum",
    });
  });

  it("prices each resolution from fal's page, and the profile at 720p", () => {
    expect([wanClipPriceUsd("480p"), wanClipPriceUsd("580p"), wanClipPriceUsd("720p")]).toEqual([0.05, 0.075, 0.1]);
    expect(falEstimate(ENDPOINT)).toMatchObject({ priced: true, estimate: { micros: 100_000 }, profile: "wan/v2.2-a14b/image-to-video/turbo@v1" });
  });
});

describe("videoGenerationStatus", () => {
  it("reports Wan beside MiniMax, each ready only with FAL_KEY", () => {
    const ready = videoGenerationStatus(true);
    expect(ready["video-generation"].available).toBe(true);
    expect(ready["video-generation-wan"]).toMatchObject({ available: true, detail: expect.stringContaining("pva_generate_wan_video") });
    expect(videoGenerationStatus(false)["video-generation-wan"]).toEqual({ available: false, detail: "FAL_KEY not set" });
  });
});

describe("pva_generate_wan_video", () => {
  let root: string;
  let dir: string;
  let previous: { root?: string; fal?: string };
  let fetchMock: ReturnType<typeof vi.fn>;
  let tool: Tool;
  let submitted: Record<string, unknown> | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-wan-"));
    dir = join(root, CHANNEL, "series", SERIES, "episodes", EPISODE);
    mkdirSync(join(dir, "journal"), { recursive: true });
    mkdirSync(join(dir, "assets", "crops"), { recursive: true });
    writeFileSync(join(dir, "assets", "crops", "fuoco.png"), PNG);
    writeFileSync(join(dir, "assets", "crops", "fuoco-end.jpg"), Buffer.from("jpeg"));
    previous = { root: process.env.AVG_LIBRARY_ROOT, fal: process.env.FAL_KEY };
    process.env.AVG_LIBRARY_ROOT = root;
    process.env.FAL_KEY = "fal-key-for-tests";
    submitted = undefined;

    fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === QUEUE && init?.method === "POST") {
        submitted = JSON.parse(init.body!);
        return Response.json({
          request_id: "req-123",
          status_url: `${QUEUE}/requests/req-123/status`,
          response_url: `${QUEUE}/requests/req-123`,
        });
      }
      if (url.endsWith("/requests/req-123/status")) return Response.json({ status: "COMPLETED" });
      if (url.endsWith("/requests/req-123")) {
        return Response.json({ video: { url: "https://cdn.example/wan.mp4", content_type: "video/mp4" }, seed: 7, prompt: "x" });
      }
      if (url === "https://cdn.example/wan.mp4") return new Response(Buffer.from("mp4 bytes"), { status: 200 });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tools: Tool[] = [];
    registerWanTools({ registerTool: (t: Tool) => tools.push(t) } as never);
    tool = tools.find((t) => t.name === "pva_generate_wan_video")!;
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
  const generate = (extra: Record<string, unknown> = {}, onUpdate?: (u: unknown) => void) => tool.execute("call-1", {
    channel: CHANNEL, series: SERIES, episode: EPISODE, name: "fuoco",
    prompt: "locked camera; only the flame moves", imagePath: "assets/crops/fuoco.png", ...extra,
  }, undefined, onUpdate, {});

  it("submits a closed loop: the end frame is the start frame", async () => {
    budget(1_000_000);
    const updates: unknown[] = [];
    const result = await generate({ loop: true, seed: 11 }, (u) => updates.push(u));

    const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;
    expect(submitted).toMatchObject({
      image_url: dataUrl,
      end_image_url: dataUrl,
      prompt: "locked camera; only the flame moves",
      resolution: "720p",
      aspect_ratio: "auto",
      seed: 11,
      enable_prompt_expansion: false,
      enable_safety_checker: true,
    });
    expect(updates.length).toBeGreaterThan(0);
    expect(result.details).toMatchObject({ providerRequestId: "req-123", seed: 11, estimatedCostUsd: 0.1 });
  });

  it("sends a different end image when one is named, and none without", async () => {
    await generate({ endImagePath: "assets/crops/fuoco-end.jpg", name: "a" });
    expect(String(submitted!.end_image_url)).toMatch(/^data:image\/jpeg;base64,/);
    await generate({ name: "b" });
    expect(submitted).not.toHaveProperty("end_image_url");
    expect(typeof submitted!.seed).toBe("number"); // picked and recorded when not given
  });

  it("places the clip and its provenance under assets/video/wan", async () => {
    budget(1_000_000);
    await generate({ loop: true, seed: 3, resolution: "480p" });
    const clip = join(dir, "assets", "video", "wan", "fuoco.mp4");
    expect(readFileSync(clip, "utf-8")).toBe("mp4 bytes");
    const provenance = JSON.parse(readFileSync(join(dir, "assets", "video", "wan", "fuoco.provenance.json"), "utf-8"));
    expect(provenance).toMatchObject({
      provider: "fal.ai",
      endpointId: ENDPOINT,
      profileId: "wan/v2.2-a14b/image-to-video/turbo@v1",
      providerRequestId: "req-123",
      prompt: "locked camera; only the flame moves",
      imagePath: "assets/crops/fuoco.png",
      endImagePath: "assets/crops/fuoco.png",
      loop: true,
      seed: 3,
      resolution: "480p",
      estimatedCost: { amount: 0.05, currency: "USD" },
    });
  });

  it("reserves this resolution's price on the ledger and settles it", async () => {
    budget(1_000_000);
    await generate({ resolution: "580p" });
    const events = journal();
    expect(events.map((e) => e.type)).toEqual(["spend-reserved", "spend-settled"]);
    expect(events[0]!.data).toMatchObject({
      capability: "video.generate", provider: "fal", profile: "wan/v2.2-a14b/image-to-video/turbo@v1",
      purpose: "clip fuoco", estimate: { currency: "USD", micros: 75_000 },
    });
    expect(events[1]!.data).toMatchObject({ cost: { micros: 75_000 } });
  });

  it("refuses over budget without calling fal or writing anything", async () => {
    budget(90_000);
    await expect(generate({ loop: true })).rejects.toThrow(/budget/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
    expect(existsSync(join(dir, "assets", "video", "wan", "fuoco.mp4"))).toBe(false);
  });

  it("releases the reservation when fal refuses the request", async () => {
    budget(1_000_000);
    fetchMock.mockImplementationOnce(async () => Response.json({ detail: "bad image" }, { status: 422 }));
    await expect(generate()).rejects.toThrow();
    expect(journal().map((e) => e.type)).toEqual(["spend-reserved", "spend-released"]);
  });

  it("refuses before spending: a taken name, a path outside the episode, no FAL_KEY", async () => {
    mkdirSync(join(dir, "assets", "video", "wan"), { recursive: true });
    writeFileSync(join(dir, "assets", "video", "wan", "fuoco.mp4"), "old");
    await expect(generate()).rejects.toThrow(/already exists/);
    await expect(generate({ name: "x", imagePath: "../../../../secret.png" })).rejects.toThrow();
    delete process.env.FAL_KEY;
    await expect(generate({ name: "y" })).rejects.toThrow(/FAL_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
