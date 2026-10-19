import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMediaStoreTools } from "../src/media-store-tools.js";

/** pva_channel_media: a channel's media between machines, on a faked S3 bucket. */

const VARS = ["AVG_LIBRARY_ROOT", "AVG_MEDIA_STORE", "AVG_MEDIA_STORE_BUCKET", "AVG_MEDIA_STORE_ACCESS_KEY_ID", "AVG_MEDIA_STORE_SECRET_ACCESS_KEY"] as const;
const previous = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
let root: string;
let server: Server;
const objects = new Map<string, Buffer>();
const IMAGE = "satira/series/cronaca/episodes/one/assets/images/face.png";

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "media-tools-"));
  objects.clear();
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const path = decodeURIComponent(req.url!);
    if (path === "/assets") return res.writeHead(200).end();
    if (req.method === "PUT") {
      objects.set(path, Buffer.concat(chunks));
      return res.writeHead(200).end();
    }
    const body = objects.get(path);
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { "content-length": body.length });
    return res.end(req.method === "GET" ? body : undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.AVG_MEDIA_STORE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.AVG_MEDIA_STORE_BUCKET = "assets";
  process.env.AVG_MEDIA_STORE_ACCESS_KEY_ID = "GKtest";
  process.env.AVG_MEDIA_STORE_SECRET_ACCESS_KEY = "secret";
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
  for (const v of VARS) if (previous[v] === undefined) delete process.env[v]; else process.env[v] = previous[v];
});

/** The tool as one machine's library sees it. */
function machine(name: string) {
  process.env.AVG_LIBRARY_ROOT = join(root, name);
  mkdirSync(join(root, name, "satira"), { recursive: true });
  const registered = new Map<string, any>();
  registerMediaStoreTools({ registerTool: (t: { name: string }) => registered.set(t.name, t) } as never);
  return (action: string) => registered.get("pva_channel_media")!.execute("call", { channel: "satira", action }, undefined, () => {});
}

describe("pva_channel_media", () => {
  it("pushes what one machine made, and another pulls what it lacks", async () => {
    const here = machine("here");
    mkdirSync(join(root, "here", IMAGE, ".."), { recursive: true });
    writeFileSync(join(root, "here", IMAGE), "a face");
    const pushed = await here("push");
    expect(pushed.content[0].text).toContain("1 files");
    expect(objects.size).toBe(1);

    const there = machine("there");
    copyFileSync(join(root, "here", "satira", "media.lock.jsonl"), join(root, "there", "satira", "media.lock.jsonl"));
    expect((await there("check")).content[0].text).toContain(`missing — pull them (1): ${IMAGE.replace("satira/", "")}`);
    await there("pull");
    expect(readFileSync(join(root, "there", IMAGE), "utf-8")).toBe("a face");
    expect((await there("check")).content[0].text).toContain("every media file is here");
  });

  it("throws when the store is not set, naming what is missing", async () => {
    const here = machine("here");
    writeFileSync(join(root, "here", "satira", "media.lock.jsonl"), "");
    delete process.env.AVG_MEDIA_STORE_BUCKET;
    await expect(here("pull")).rejects.toThrow("set AVG_MEDIA_STORE_BUCKET");
  });
});
