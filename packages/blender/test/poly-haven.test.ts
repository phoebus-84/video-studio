import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { downloadAsset, flattenFiles, validateDownloadUrl } from "../src/poly-haven.js";

test("file discovery preserves resolution keys and dependency entries", () => {
  const files = flattenFiles({ blend: { "1k": { blend: { url: "https://dl.polyhaven.org/a.blend", include: { tex: { url: "https://dl.polyhaven.org/a.jpg" } } } } } });
  assert.deepEqual(files.map(f => f.key), ["blend.1k.blend", "blend.1k.blend.include.tex"]);
});
test("download URL is allowlisted, not an arbitrary network fetch", () => {
  for (const url of ["http://dl.polyhaven.org/x", "https://evil.example/x", "https://dl.polyhaven.org.evil.com/x", "https://user@dl.polyhaven.org/x", "https://dl.polyhaven.org:123/x"]) {
    assert.throws(() => validateDownloadUrl(url));
  }
  assert.equal(validateDownloadUrl("https://dl.polyhaven.org/file.hdr").hostname, "dl.polyhaven.org");
});
test("explicit file download is bounded, verified and records CC0 provenance", async t => {
  const root = await mkdtemp(join(tmpdir(), "polyhaven-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const bytes = Buffer.from("HDR bytes");
  globalThis.fetch = (async (url: string | URL) => String(url).includes("api.polyhaven.com")
    ? Response.json({ hdri: { "1k": { hdr: { url: "https://dl.polyhaven.org/example.hdr", size: bytes.length, md5: createHash("md5").update(bytes).digest("hex") } } } })
    : new Response(bytes)) as typeof fetch;
  const result = await downloadAsset("example", "hdri.1k.hdr", join(root, "ok"));
  assert.equal(result.license, "CC0-1.0");
  assert.equal(await readFile(result.path, "utf8"), bytes.toString());
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  await assert.rejects(downloadAsset("example", "hdri.1k.hdr", join(root, "budget"), { maxBytes: 1 }), /budget/);
  await assert.rejects(downloadAsset("example", "hdri.8k.hdr", join(root, "missing")), /Unknown file/);
  globalThis.fetch = (async (url: string | URL) => String(url).includes("api.polyhaven.com")
    ? Response.json({ hdr: { url: "https://dl.polyhaven.org/a.hdr", md5: "wrong" } }) : new Response(bytes)) as typeof fetch;
  await assert.rejects(downloadAsset("example", "hdr", join(root, "checksum")), /MD5 mismatch/);
});
