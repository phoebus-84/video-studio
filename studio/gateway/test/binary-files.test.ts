import { describe, it, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { resolveToken } from "../src/auth/index.js";
import { createGateway, type GatewayInstance } from "../src/server.js";
import { parseRange } from "../src/routes/editor.js";

const TMP = resolve(".test-tmp/binary-files");

/**
 * Binary artifacts must survive the trip to the browser.
 *
 * The file route used to wrap every read in a JSON envelope built with
 * `content.toString("utf-8")`. For text that is fine; for a PNG or a WAV it is
 * lossy in one direction — every byte sequence that is not valid UTF-8 becomes
 * U+FFFD and cannot be recovered. The request still returned 200, so the studio
 * looked like it had a rendering bug when in fact the bytes were already gone.
 *
 * These tests pin the boundary: text keeps its envelope, media comes back
 * byte-identical with a real content type.
 */
describe("serving binary artifacts", () => {
  let gateway: GatewayInstance;
  let baseUrl: string;
  let token: string;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const episode = () =>
    `${baseUrl}/api/channels/acme/series/s1/episodes/ep-01/file`;

  /* A one-pixel PNG: a real file whose bytes are not valid UTF-8. */
  const PNG = Buffer.from(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
      "01f15c4890000000a49444154789c6300010000050001",
    "hex",
  );

  beforeAll(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
    await fs.mkdir(TMP, { recursive: true });

    const config = loadConfig();
    config.port = 0;
    config.host = "127.0.0.1";
    config.token.file = join(TMP, "token");
    // Alongside the token file, or `createGateway` resolves the operator key
    // at its default `.operator-key` and writes it into studio/gateway/.
    config.operatorKey.file = join(TMP, "operator-key");
    config.libraryRoots = [TMP];

    token = resolveToken(config.token);
    gateway = await createGateway(config, token);
    baseUrl = await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
    await fs.rm(TMP, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const dir = join(TMP, "acme", "series", "s1", "episodes", "ep-01");
    await fs.rm(join(TMP, "acme"), { recursive: true, force: true });
    await fs.mkdir(join(dir, "artifacts"), { recursive: true });
    await fs.writeFile(join(dir, "artifacts", "frame.png"), PNG);
    await fs.writeFile(join(dir, "artifacts", "script.md"), "# Scene 1\n");
  });

  it("returns image bytes unchanged", async () => {
    const res = await fetch(`${episode()}/artifacts/frame.png`, { headers: auth() });
    expect(res.status).toBe(200);

    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(PNG)).toBe(true);
  });

  it("labels media with its real content type", async () => {
    const res = await fetch(`${episode()}/artifacts/frame.png`, { headers: auth() });
    expect(res.headers.get("content-type")).toContain("image/png");
  });

  it("does not mangle bytes into replacement characters", async () => {
    /* The exact failure this fixes: U+FFFD is 0xEF 0xBF 0xBD in the response. */
    const res = await fetch(`${episode()}/artifacts/frame.png`, { headers: auth() });
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
  });

  it("does not hash media just to label it", async () => {
    /* The revision is a hash of the whole file. Computing it per range request
       would defeat streaming, and only the text write path (If-Match) consumes
       it — so media reports size and mtime and skips the hash. */
    const res = await fetch(`${episode()}/artifacts/frame.png`, { headers: auth() });
    expect(res.headers.get("x-content-revision")).toBeNull();
    expect(res.headers.get("x-last-modified")).toBeTruthy();
  });

  it("still returns the revision header for text", async () => {
    const res = await fetch(`${episode()}/artifacts/script.md`, { headers: auth() });
    expect(res.headers.get("x-content-revision")).toBeTruthy();
  });

  it("keeps the JSON envelope for text", async () => {
    const res = await fetch(`${episode()}/artifacts/script.md`, { headers: auth() });
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body.content).toBe("# Scene 1\n");
    expect(body.revision).toBeTruthy();
  });

  it("still reports a missing file as 404", async () => {
    const res = await fetch(`${episode()}/artifacts/nope.png`, { headers: auth() });
    expect(res.status).toBe(404);
  });

  // ── Range requests ──────────────────────────────────────────────────

  it("advertises range support on media", async () => {
    const res = await fetch(`${episode()}/artifacts/frame.png`, { headers: auth() });
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  it("serves a byte range as 206 with Content-Range", async () => {
    const res = await fetch(`${episode()}/artifacts/frame.png`, {
      headers: { ...auth(), range: "bytes=0-9" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-9/${PNG.length}`);

    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.length).toBe(10);
    expect(bytes.equals(PNG.subarray(0, 10))).toBe(true);
  });

  it("serves an open-ended range to the end of the file", async () => {
    const res = await fetch(`${episode()}/artifacts/frame.png`, {
      headers: { ...auth(), range: "bytes=10-" },
    });
    expect(res.status).toBe(206);

    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(PNG.subarray(10))).toBe(true);
  });

  it("answers 416 for a range past the end", async () => {
    /* Streaming nothing would look like a stall; 416 tells the player. */
    const res = await fetch(`${episode()}/artifacts/frame.png`, {
      headers: { ...auth(), range: `bytes=${PNG.length + 10}-` },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${PNG.length}`);
  });

  it("ignores Range on text, which keeps its envelope", async () => {
    const res = await fetch(`${episode()}/artifacts/script.md`, {
      headers: { ...auth(), range: "bytes=0-3" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).content).toBe("# Scene 1\n");
  });
});

describe("parsing Range headers", () => {
  test.each([
    ["bytes=0-99", { start: 0, end: 99 }],
    ["bytes=100-", { start: 100, end: 999 }],
    ["bytes=-100", { start: 900, end: 999 }],
    ["bytes=0-99999", { start: 0, end: 999 }],
    [" bytes=5-10 ", { start: 5, end: 10 }],
  ])("%s over a 1000-byte file", (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected);
  });

  it("returns null when there is no range to honour", () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    /* Multi-range is legal HTTP but not what media elements send; falling back
       to the whole file is correct and simpler than a multipart response. */
    expect(parseRange("bytes=0-9,20-29", 1000)).toBeNull();
    expect(parseRange("items=0-9", 1000)).toBeNull();
  });

  it("reports ranges that cannot be satisfied", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=1500-1600", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("clamps a suffix range longer than the file", () => {
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });
});
