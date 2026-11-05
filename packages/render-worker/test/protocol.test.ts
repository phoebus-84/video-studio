import assert from "node:assert/strict";
import { test } from "node:test";
import { checkJobPath, checkKey, decodeBundle, encodeBundle, lastJsonLine, mirrorPath, type ManifestEntry } from "../src/protocol.js";
import { engineCommand } from "../src/hosts.js";
import { shellPath, shellQuote } from "../src/ssh.js";
import { sha256 } from "./helpers.js";

test("mirrorPath puts every absolute path under files/, drive letters and UNC included", () => {
  assert.equal(mirrorPath("F:\\lib\\ch\\a.png"), "files/F/lib/ch/a.png");
  assert.equal(mirrorPath("f:/lib/ch/a.png"), "files/F/lib/ch/a.png");
  assert.equal(mirrorPath("\\\\nas\\share\\x.wav"), "files/unc/nas/share/x.wav");
  assert.equal(mirrorPath("/home/u/lib/../x.wav"), "files/home/u/x.wav");
  assert.equal(mirrorPath("/../../etc/passwd"), "files/etc/passwd");
  assert.throws(() => mirrorPath("relative/x"), { code: "bad-path" });
});

test("checkKey takes three plain segments and nothing else", () => {
  assert.equal(checkKey("chan/series-1/ep_01"), "chan/series-1/ep_01");
  for (const bad of ["a/b", "a/b/c/d", "a/../c", "a//c", "/a/b/c", "a/b/.c", "a/b/c d"]) {
    assert.throws(() => checkKey(bad), { code: "bad-key" }, bad);
  }
});

test("checkJobPath refuses anything that could leave files/", () => {
  assert.equal(checkJobPath("files/F/x.png"), "files/F/x.png");
  for (const bad of ["files", "files/../x", "other/x", "files//x", "files/a\\b", "/files/x", "files/./x"]) {
    assert.throws(() => checkJobPath(bad), { code: "bad-path" }, bad);
  }
});

test("a bundle decodes to the files it encoded, however its bytes are split", async () => {
  const a = Buffer.from("first file\nwith a newline");
  const b = Buffer.alloc(0);
  const c = Buffer.alloc(70_000, 7);
  const files = [
    { entry: { path: "files/a", size: a.length, hash: sha256(a) }, bytes: a },
    { entry: { path: "files/dir/b", size: 0, hash: sha256(b) }, bytes: b },
    { entry: { path: "files/c", size: c.length, hash: sha256(c) }, bytes: c },
  ];
  const chunks: Buffer[] = [];
  for await (const chunk of encodeBundle(files.map((f) => ({ entry: f.entry, read: async function* () { yield f.bytes; } })))) chunks.push(chunk);
  const whole = Buffer.concat(chunks);
  const split = async function* () {
    for (let i = 0; i < whole.length; i += 7) yield whole.subarray(i, i + 7);
  };
  const got: { entry: ManifestEntry; bytes: Buffer }[] = [];
  let current: Buffer[] = [];
  const count = await decodeBundle(split(), {
    start: () => void (current = []),
    data: (chunk) => void current.push(Buffer.from(chunk)),
    end: (entry) => void got.push({ entry, bytes: Buffer.concat(current) }),
  });
  assert.equal(count, 3);
  assert.deepEqual(got.map((g) => g.entry), files.map((f) => f.entry));
  assert.deepEqual(got.map((g) => g.bytes), files.map((f) => f.bytes));
});

test("a bundle that stops in the middle of a file is refused", async () => {
  const header = `${JSON.stringify({ path: "files/a", size: 10, hash: sha256("0123456789") })}\n0123`;
  await assert.rejects(decodeBundle([Buffer.from(header)], { start() {}, data() {}, end() {} }), { code: "transfer-failed" });
});

test("a bundle header naming a path outside files/ is refused", async () => {
  const header = `${JSON.stringify({ path: "files/../../x", size: 0, hash: sha256("") })}\n`;
  await assert.rejects(decodeBundle([Buffer.from(header)], { start() {}, data() {}, end() {} }), { code: "bad-path" });
});

test("an encoded file that changes size while it is read stops the bundle", async () => {
  const encoding = encodeBundle([{ entry: { path: "files/a", size: 3, hash: sha256("abc") }, read: async function* () { yield Buffer.from("abcd"); } }]);
  await assert.rejects(async () => { for await (const _ of encoding) { /* drain */ } }, { code: "transfer-failed" });
});

test("lastJsonLine reads the answer after any log lines", () => {
  assert.deepEqual(lastJsonLine("noise\n{\"ok\":1}\n\n"), { ok: 1 });
  assert.throws(() => lastJsonLine("not json"), { code: "engine-failed" });
});

test("shell words are quoted for a POSIX shell, ~/ left to expand", () => {
  assert.equal(shellQuote("plain/path-1.2"), "plain/path-1.2");
  assert.equal(shellQuote("it's here"), `'it'\\''s here'`);
  assert.equal(shellQuote("$(rm -rf /)"), `'$(rm -rf /)'`);
  assert.equal(shellPath("~/video studio"), "~/'video studio'");
  assert.equal(engineCommand({ name: "render-box", destination: "someone@100.64.0.9", repo: "~/clone", cache: "/srv/cache dir" }, ["diff", "c/s/e"]),
    "~/clone/packages/render-worker/engine.sh --cache '/srv/cache dir' diff c/s/e");
});
