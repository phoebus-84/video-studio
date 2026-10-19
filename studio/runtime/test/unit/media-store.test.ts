import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMedia, MEDIA_LOCK, writeMediaLock } from "../../src/channel-repo.js";
import { connect, pullMedia, pushMedia, signRequest, storeFromEnv, type StoreConfig } from "../../src/media-store.js";

/**
 * A channel's media in a shared S3-compatible store, by the hash
 * media.lock.jsonl names them with (ADR-0045): one machine pushes, another
 * pulls what it lacks, and a download is kept only when it is those bytes.
 */

let root: string;
let server: Server;
let objects: Map<string, Buffer>;
let requests: string[];
let config: StoreConfig;
const sha = (bytes: string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const EP = "series/poetry/episodes/morning";
const put = (channel: string, relative: string, content: string) => {
  mkdirSync(join(root, channel, relative, ".."), { recursive: true });
  writeFileSync(join(root, channel, relative), content);
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "media-store-"));
  objects = new Map();
  requests = [];
  // A bucket "assets", path-style, that wants a SigV4 header and nothing more.
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const path = decodeURIComponent(req.url!.split("?")[0]!);
    requests.push(`${req.method} ${path}`);
    if (!String(req.headers.authorization).startsWith("AWS4-HMAC-SHA256 Credential=GKtest/")) return res.writeHead(403).end();
    if (path === "/assets") return res.writeHead(req.method === "HEAD" ? 200 : 405).end();
    const key = path.replace(/^\/assets\//, "");
    if (req.method === "PUT") {
      objects.set(key, Buffer.concat(chunks));
      return res.writeHead(200).end();
    }
    const body = objects.get(key);
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { "content-length": body.length });
    return res.end(req.method === "GET" ? body : undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  config = storeFromEnv({
    AVG_MEDIA_STORE: `http://127.0.0.1:1, http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    AVG_MEDIA_STORE_BUCKET: "assets",
    AVG_MEDIA_STORE_REGION: "garage",
    AVG_MEDIA_STORE_ACCESS_KEY_ID: "GKtest",
    AVG_MEDIA_STORE_SECRET_ACCESS_KEY: "secret",
  });
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

describe("signRequest", () => {
  it("signs as AWS's own SigV4 example for GET /test.txt", () => {
    const headers = signRequest(
      { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
      {
        method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", headers: { range: "bytes=0-9" },
        payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", now: new Date("2013-05-24T00:00:00Z"),
      },
    );
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

describe("storeFromEnv", () => {
  it("names what is missing instead of guessing a store", () => {
    expect(() => storeFromEnv({ AVG_MEDIA_STORE: "http://h:3900" })).toThrow(
      "no media store: set AVG_MEDIA_STORE_BUCKET, AVG_MEDIA_STORE_ACCESS_KEY_ID, AVG_MEDIA_STORE_SECRET_ACCESS_KEY",
    );
  });
});

describe("pushMedia and pullMedia", () => {
  it("takes the first endpoint that answers: the LAN at home, the VPN away", async () => {
    const store = await connect(config);
    expect(store.endpoint).toBe(config.endpoints[1]);
  });

  it("sends each hash once, and another machine fetches what it lacks", async () => {
    put("here", `${EP}/assets/images/sea.png`, "a sea");
    put("here", `${EP}/assets/images/sea-copy.png`, "a sea");
    put("here", `${EP}/output/render-1.mp4`, "a video");
    writeMediaLock(join(root, "here"));
    const store = await connect(config);

    const pushed = await pushMedia(join(root, "here"), store);
    expect(pushed.moved.map((m) => m.hash).sort()).toEqual([sha("a sea"), sha("a video")].sort());
    expect([...objects.keys()].every((k) => /^video-studio\/media\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(k))).toBe(true);
    // A second push finds them there and sends nothing.
    expect((await pushMedia(join(root, "here"), store)).present).toBe(2);
    expect(requests.filter((r) => r.startsWith("PUT"))).toHaveLength(2);

    // The other machine has the lock (from git) and none of the media.
    put("there", MEDIA_LOCK, readFileSync(join(root, "here", MEDIA_LOCK), "utf-8"));
    const pulled = await pullMedia(join(root, "there"), store);
    expect(pulled.moved).toHaveLength(3);
    expect(readFileSync(join(root, "there", EP, "output/render-1.mp4"), "utf-8")).toBe("a video");
    expect(checkMedia(join(root, "there")).ok).toBe(true);
  });

  it("leaves a file the lock does not name with these bytes", async () => {
    put("here", `${EP}/assets/images/sea.png`, "a sea");
    writeMediaLock(join(root, "here"));
    put("here", `${EP}/assets/images/sea.png`, "another sea");
    put("here", `${EP}/assets/images/sky.png`, "a sky");
    const pushed = await pushMedia(join(root, "here"), await connect(config));
    expect(pushed.moved).toEqual([]);
    expect(pushed.skipped.map((s) => s.path)).toEqual([`${EP}/assets/images/sea.png`, `${EP}/assets/images/sky.png`]);
  });

  it("leaves files over maxBytes here: the hour-long finals, made again from their master", async () => {
    put("here", `${EP}/assets/video/master.mp4`, "a loop");
    put("here", `${EP}/output/final-1h.mp4`, "an hour of the loop");
    writeMediaLock(join(root, "here"));
    const pushed = await pushMedia(join(root, "here"), await connect(config), { maxBytes: 10 });
    expect(pushed.moved.map((m) => m.path)).toEqual([`${EP}/assets/video/master.mp4`]);
    expect(pushed.skipped).toEqual([{ path: `${EP}/output/final-1h.mp4`, reason: "0 MB, over the 0 MB asked" }]);
  });

  it("keeps no download that is not the bytes the lock names", async () => {
    put("here", `${EP}/assets/images/sea.png`, "a sea");
    writeMediaLock(join(root, "here"));
    const store = await connect(config);
    await pushMedia(join(root, "here"), store);
    for (const key of objects.keys()) objects.set(key, Buffer.from("a storm"));

    put("there", MEDIA_LOCK, readFileSync(join(root, "here", MEDIA_LOCK), "utf-8"));
    const pulled = await pullMedia(join(root, "there"), store);
    expect(pulled.failed).toHaveLength(1);
    expect(existsSync(join(root, "there", EP, "assets/images/sea.png"))).toBe(false);
    expect(existsSync(join(root, "there", EP, "assets/images/sea.png.tmp"))).toBe(false);
  });

  it("says who should push what the store lacks", async () => {
    put("there", MEDIA_LOCK, `${JSON.stringify({ apiVersion: "studio.video/v1alpha1", kind: "MediaLock" })}\n${JSON.stringify({ path: "a.png", hash: sha("x"), size: 1 })}\n`);
    const pulled = await pullMedia(join(root, "there"), await connect(config));
    expect(pulled.failed).toEqual([{ path: "a.png", error: "not in the store: whoever has it pushes it" }]);
  });
});
