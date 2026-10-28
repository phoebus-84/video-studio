// ---------------------------------------------------------------------------
// Image generations run concurrently
// ---------------------------------------------------------------------------
// Several pictures asked for at once must be drawn at once: four Codex edits
// should take about as long as one. These drive the real extension through
// the MCP server against a fake Codex backend that answers each request only
// after DELAY_MS, and count how many requests are in flight together.
//
// The server answers concurrent calls concurrently (the first test). Claude
// Code, though, sends the tool calls of one turn one after another unless the
// tool is marked read-only, so the studio's own batch tool,
// pva_generate_images, is what makes N pictures cost the time of one.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPvaServer } from "../mcp/server.js";
import { createModelRegistry } from "../mcp/credentials.js";

const EXTENSION = new URL("../extensions/index.ts", import.meta.url).href;
const CHANNEL = "poesia";
const SERIES = "versi";
const EPISODE = "ep";
const DELAY_MS = 400;

const TOKEN = (() => {
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } })}.sig`;
})();

let root: string;
let previousRoot: string | undefined;
let inFlight = 0;
let peak = 0;
let requests = 0;

/** A Codex backend that takes DELAY_MS per image and counts overlapping requests. */
function slowCodex() {
  return vi.fn(async (url: string | URL | Request) => {
    if (!String(url).includes("chatgpt.com")) throw new Error(`unexpected fetch ${String(url)}`);
    requests += 1;
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, DELAY_MS));
    inFlight -= 1;
    const event = {
      type: "response.output_item.done",
      item: { type: "image_generation_call", result: Buffer.from("PNGBYTES").toString("base64") },
    };
    return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-parallel-"));
  mkdirSync(join(root, CHANNEL, "series", SERIES, "episodes", EPISODE, "journal"), { recursive: true });
  writeFileSync(join(root, CHANNEL, "pipeline.yaml"), "image:\n  provider: openai-codex\n");
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  inFlight = 0;
  peak = 0;
  requests = 0;
  vi.stubGlobal("fetch", slowCodex());
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT; else process.env.AVG_LIBRARY_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

async function connect() {
  const env = { AVG_CODEX_TOKEN: TOKEN };
  const pva = await createPvaServer({
    extension: EXTENSION,
    cwd: root,
    env: { AVG_CLAUDE_STATE_DIR: join(root, ".state"), ...env },
    modelRegistry: createModelRegistry({ env, piRegistry: async () => null, codexCli: () => undefined }),
    log: () => {},
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await pva.server.connect(serverSide);
  await client.connect(clientSide);
  return client;
}

const where = { channel: CHANNEL, series: SERIES, episode: EPISODE };
const image = (path: string) => join(root, CHANNEL, "series", SERIES, "episodes", EPISODE, "assets", "images", path);

describe("image generation in parallel", () => {
  it("serves several pva_generate_image calls at once over MCP", async () => {
    const client = await connect();
    const started = Date.now();
    const results = await Promise.all(["s1", "s2", "s3", "s4"].map((sceneId) =>
      client.callTool({ name: "pva_generate_image", arguments: { ...where, sceneId, prompt: `scene ${sceneId}` } })));
    const elapsed = Date.now() - started;

    for (const result of results) expect(result.isError).toBe(false);
    expect(requests).toBe(4);
    expect(peak).toBe(4);
    expect(elapsed).toBeLessThan(DELAY_MS * 2.5);
    for (const sceneId of ["s1", "s2", "s3", "s4"]) expect(existsSync(image(`${sceneId}.png`))).toBe(true);
  }, 60_000);
});

describe("pva_generate_images", () => {
  it("draws every image of one call at the same time", async () => {
    const client = await connect();
    const started = Date.now();
    const result = await client.callTool({
      name: "pva_generate_images",
      arguments: { ...where, images: ["s1", "s2", "s3", "s4"].map((sceneId) => ({ sceneId, prompt: `scene ${sceneId}` })) },
    });
    const elapsed = Date.now() - started;

    expect(result.isError).toBe(false);
    expect((result.content as Array<{ text: string }>)[0]!.text).toMatch(/^4\/4 images generated/);
    expect(requests).toBe(4);
    expect(peak).toBe(4);
    expect(elapsed).toBeLessThan(DELAY_MS * 2.5);
    for (const sceneId of ["s1", "s2", "s3", "s4"]) expect(existsSync(image(`${sceneId}.png`))).toBe(true);
  }, 60_000);

  it("reports an image that fails without failing the others", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "pva_generate_images",
      arguments: {
        ...where,
        images: [
          { sceneId: "s1", prompt: "a lighthouse" },
          { sceneId: "s2", prompt: "a reef", referenceImagePaths: ["assets/images/missing.png"] },
        ],
      },
    });
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(result.isError).toBe(false);
    expect(text).toMatch(/^1\/2 images generated/);
    expect(text).toMatch(/s2: ❌ Failed: Reference image not found/);
    expect(existsSync(image("s1.png"))).toBe(true);
  }, 60_000);

  it("refuses two images with the same sceneId before drawing anything", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "pva_generate_images",
      arguments: { ...where, images: [{ sceneId: "s1", prompt: "a" }, { sceneId: "s1", prompt: "b" }] },
    });
    expect(result.isError).toBe(true);
    expect(requests).toBe(0);
  }, 60_000);
});
