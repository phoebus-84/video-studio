import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { s3MediaStore } from "../../src/media-s3.js";
import type { MediaTransferReport } from "../../src/media-remote.js";
import { fakeS3 } from "../helpers/fake-s3.js";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/src/cli.js");
const EP = "series/test/episodes/one";
const IMAGE = `${EP}/assets/plate.png`;
let root: string;
let remote: Awaited<ReturnType<typeof fakeS3>>;
const sha = (data: Buffer) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
const config = (extra: Record<string, unknown> = {}) => writeFileSync(join(root, "sample/media.remote.json"), JSON.stringify({
  apiVersion: "studio.video/v1alpha1", kind: "MediaRemote", url: "s3://media/shared/", endpoint: remote.endpoint, region: "auto", ...extra,
}));

async function vpr(args: string[]) {
  return new Promise<{ status: number; json: Partial<MediaTransferReport> & { remote?: string[] }; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "channel", ...args, "--library", root, "--json"], {
      env: { ...process.env, AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_EC2_METADATA_DISABLED: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      try { resolve({ status: code ?? 1, json: JSON.parse(stdout), stderr }); }
      catch { reject(new Error(`CLI emitted invalid JSON: ${stdout}\n${stderr}`)); }
    });
  });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "cli-media-remote-"));
  mkdirSync(join(root, "sample", EP, "assets"), { recursive: true });
  writeFileSync(join(root, "sample", IMAGE), "plate");
  remote = await fakeS3();
  config();
  vi.stubEnv("AWS_ACCESS_KEY_ID", "test");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test");
  vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");
});
afterEach(async () => {
  await remote.close();
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("CLI through the S3 HTTP API", { timeout: 30_000 }, () => {
  it("pushes, reports remote, scopes a dry run, restores a fresh media tree and checks offline", async () => {
    expect((await vpr(["media", "sample"])).status).toBe(0);
    const pushed = await vpr(["media", "push", "sample"]);
    expect(pushed.status, JSON.stringify(pushed)).toBe(0);
    expect(pushed.json.bytes).toBe(5);
    expect(remote.objects.size).toBe(1);
    const put = remote.requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-none-match"]).toBe("*");
    expect(put.headers.authorization).toMatch(/^AWS4-HMAC-SHA256/);
    expect(put.headers["x-amz-checksum-sha256"]).toBe(createHash("sha256").update("plate").digest("base64"));
    expect((await vpr(["media", "push", "sample"])).json.transferred).toEqual([]);
    rmSync(join(root, "sample/series"), { recursive: true });
    const checked = await vpr(["media", "sample", "--check"]);
    expect(checked.status).toBe(2);
    expect(checked.json.remote).toEqual([IMAGE]);
    const dry = await vpr(["media", "pull", "--episode", "test/one", "sample", "--dry-run", "--tier", "all"]);
    expect(dry.status, JSON.stringify(dry)).toBe(0);
    expect(dry.json.planned).toEqual([IMAGE]);
    expect(existsSync(join(root, "sample/series"))).toBe(false);
    const pulled = await vpr(["media", "pull", "sample", "--episode", "test/one"]);
    expect(pulled.status, JSON.stringify(pulled)).toBe(0);
    expect(readFileSync(join(root, "sample", IMAGE), "utf8")).toBe("plate");
    expect((await vpr(["media", "sample", "--check", "--episode", "test/one", "--verify"])).status).toBe(0);
    const requests = remote.requests.length;
    expect((await vpr(["media", "sample", "--check", "--offline"])).status).toBe(0);
    expect(remote.requests).toHaveLength(requests);
  });

  it("refuses corruption and auth failures instead of reporting them as missing", async () => {
    await vpr(["media", "sample"]);
    await vpr(["media", "push", "sample"]);
    rmSync(join(root, "sample", IMAGE));
    remote.control.corrupt = true;
    const pull = await vpr(["media", "pull", "sample"]);
    expect(pull.status).toBe(2);
    expect(pull.json.errors?.[0]?.error).toMatch(/hash/);
    expect(existsSync(join(root, "sample", IMAGE))).toBe(false);
    remote.control.headStatus = 403;
    const check = await vpr(["media", "sample", "--check"]);
    expect(check.status).toBe(2);
    expect(check.json.errors).toHaveLength(1);
    expect(check.json.missing).toEqual([]);
  });

  it("honours tiers and rejects missing/unknown flags without accidentally rewriting the lock", async () => {
    config({ rules: [{ prefix: `${EP}/assets`, tier: "derived" }] });
    await vpr(["media", "sample"]);
    const lock = readFileSync(join(root, "sample/media.lock.jsonl"), "utf8");
    expect((await vpr(["media", "push", "sample"])).json.excluded?.derived.files).toBe(1);
    expect(remote.objects.size).toBe(0);
    expect((await vpr(["media", "push", "sample", "--tier", "derived"])).status).toBe(0);
    expect(remote.objects.size).toBe(1);
    for (const args of [
      ["media", "push"], ["media", "pull"],
      ["media", "pull", "sample", "--episode"], ["media", "pull", "sample", "--typo"],
      ["media", "push", "sample", "--prune"], ["media", "sample", "--tier", "all"],
      ["media", "pull", "sample", "extra"], ["media", "sample", "--check", "--prune"],
    ]) expect((await vpr(args)).status).toBe(1);
    expect(readFileSync(join(root, "sample/media.lock.jsonl"), "utf8")).toBe(lock);
  });
});

describe("S3 conditional and multipart writes", { timeout: 30_000 }, () => {
  it("skips a racing writer with a conditional PUT, including zero-byte objects", async () => {
    const store = s3MediaStore({ bucket: "media", endpoint: remote.endpoint, region: "auto" });
    const file = join(root, "zero");
    writeFileSync(file, "");
    try {
      expect(await store.put("empty", file, { hash: sha(Buffer.alloc(0)), size: 0 })).toBe(true);
      expect(await store.put("empty", file, { hash: sha(Buffer.alloc(0)), size: 0 })).toBe(false);
      expect(await store.head("empty")).toEqual({ size: 0 });
    } finally { store.close?.(); }
  });

  it("uploads large objects in parts, completes conditionally, aborts failures and racing uploads", async () => {
    const data = Buffer.alloc(9 * 1024 * 1024, 42);
    const file = join(root, "large");
    writeFileSync(file, data);
    const entry = { hash: sha(data), size: data.length };
    const store = s3MediaStore({ bucket: "media", endpoint: remote.endpoint, region: "auto" });
    try {
      expect(await store.put("large", file, entry)).toBe(true);
      expect(remote.objects.get("large")).toEqual(data);
      expect(remote.requests.filter((r) => r.method === "PUT" && r.query.includes("partNumber"))).toHaveLength(2);
      expect(remote.requests.find((r) => r.method === "POST" && r.query.includes("uploadId"))?.headers["if-none-match"]).toBe("*");
      expect(await store.put("large", file, entry)).toBe(false);
      expect(remote.control.aborts).toBe(1);
      remote.control.failParts = true;
      await expect(store.put("failed", file, entry)).rejects.toThrow();
      expect(remote.control.aborts).toBe(2);
      expect(remote.uploads.size).toBe(0);
      expect(remote.objects.has("failed")).toBe(false);
    } finally { store.close?.(); }
  });

  it("fails every later request at once after the remote proved unreachable", async () => {
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((done) => probe.close(() => done()));
    const store = s3MediaStore({ bucket: "media", endpoint: `http://127.0.0.1:${port}`, region: "auto" });
    let requests = 0;
    const late = createServer((_req, res) => { requests++; res.writeHead(404).end(); });
    try {
      await expect(store.head("a")).rejects.toThrow(/is unreachable/);
      await new Promise<void>((done) => late.listen(port, "127.0.0.1", done));
      await expect(store.head("b")).rejects.toThrow(/is unreachable/);
      await expect(store.put("c", join(root, "sample", IMAGE), { hash: sha(Buffer.from("plate")), size: 5 })).rejects.toThrow(/is unreachable/);
      expect(requests).toBe(0);
    } finally {
      store.close?.();
      await new Promise<void>((done) => late.close(() => done()));
    }
  });

  it("allows disabling optional checksum headers without weakening local verification", async () => {
    const store = s3MediaStore({ bucket: "media", endpoint: remote.endpoint, region: "auto", checksum: false });
    const data = Buffer.from("plate");
    try {
      await store.put("plain", join(root, "sample", IMAGE), { hash: sha(data), size: data.length });
      const headers = remote.requests.find((r) => r.method === "PUT")!.headers;
      expect(Object.keys(headers).filter((k) => k.startsWith("x-amz-checksum-"))).toEqual([]);
      expect(headers["if-none-match"]).toBe("*");
    } finally { store.close?.(); }
  });
});
