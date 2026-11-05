// prepareJob, the engine's commands and remoteRenderer end to end, with the
// engine running in this process (helpers.ts).

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PassThrough, Readable } from "node:stream";
import type { RenderTimelineOptions } from "@av/remotion-composer";
import type { Git } from "../src/code-sync.js";
import { pinMismatches, runEngine } from "../src/engine.js";
import { prepareJob } from "../src/files.js";
import { mirrorPath } from "../src/protocol.js";
import { remoteRenderer } from "../src/remote.js";
import { fakeEngine, sha256, tempDir } from "./helpers.js";

const SHA = "b".repeat(40);
/** The theme bed relative to the episode, in this platform's separators (backslashes on Windows). */
const BED = path.join("..", "..", "themes", "t1", "bed.wav");
const peers = [{ name: "render-box", dnsName: null, addresses: ["100.64.0.9"], online: true, os: "linux" }];
const cleanGit: Git = (args) => (args[0] === "rev-parse" ? { code: 0, stdout: `${SHA}\n`, stderr: "" } : { code: 0, stdout: "", stderr: "" });

/** An episode folder with assets inside it, one in a shared theme folder beside it, and a kit. */
function episode() {
  const root = tempDir("rw-lib-");
  const ep = path.join(root, "ch", "series", "ep1");
  const theme = path.join(root, "ch", "themes", "t1");
  mkdirSync(path.join(ep, "media"), { recursive: true });
  mkdirSync(theme, { recursive: true });
  const img = Buffer.from("image bytes");
  const music = Buffer.from("music bytes");
  const kit = Buffer.from("module.exports = {};");
  writeFileSync(path.join(ep, "media", "a.png"), img);
  writeFileSync(path.join(theme, "bed.wav"), music);
  writeFileSync(path.join(root, "kit.cjs"), kit);
  const options: RenderTimelineOptions = {
    timeline: {
      assets: {
        img: { path: "media/a.png", hash: sha256(img), kind: "image" },
        bed: { path: BED, hash: sha256(music), kind: "audio" },
        abs: { path: path.join(theme, "bed.wav"), hash: sha256(music), kind: "audio" },
      },
    },
    assetRoot: ep,
    sharedRoots: [theme],
    kits: [{ name: "k", version: "1.0.0", file: path.join(root, "kit.cjs"), hash: sha256(kit) }],
    outputPath: path.join(ep, "out.mp4"),
  };
  return { root, ep, theme, options, img, music };
}

test("prepareJob mirrors every file once and rewrites only paths the engine could not read", async () => {
  const { ep, theme, options } = episode();
  const { job, files } = await prepareJob(options);
  const assets = (job.timeline as { assets: Record<string, { path: string }> }).assets;
  assert.equal(assets.img!.path, "media/a.png");
  assert.equal(assets.bed!.path, "../../themes/t1/bed.wav");
  assert.equal(assets.abs!.path, "../../themes/t1/bed.wav");
  assert.equal(job.assetRoot, mirrorPath(ep));
  assert.deepEqual(job.sharedRoots, [mirrorPath(theme)]);
  assert.equal(job.kits[0]!.file, mirrorPath(path.join(path.dirname(path.dirname(path.dirname(ep))), "kit.cjs")));
  assert.equal(files.length, 3, "the shared bed is sent once");
  assert.equal((options.timeline as { assets: Record<string, { path: string }> }).assets.bed!.path, BED, "the caller's timeline is untouched");
});

test("prepareJob refuses a file whose bytes are not the ones the timeline promises", async () => {
  const { ep, options } = episode();
  writeFileSync(path.join(ep, "media", "a.png"), "changed");
  await assert.rejects(prepareJob(options), (e: Error & { code?: string; problems?: unknown[] }) => e.code === "hash-mismatch" && e.problems?.length === 1);
});

test("the engine renders, and the video comes back to outputPath with its hash checked", async () => {
  const { options } = episode();
  const engine = fakeEngine();
  const logs: string[] = [];
  const progress: number[] = [];
  const render = remoteRenderer({ host: "render-box", key: "ch/series/ep1", exec: engine.exec, git: cleanGit, peers, env: { AVG_RENDER_SSH_USER: "someone" }, onLog: (l) => logs.push(l) });
  const result = await render({ ...options, onProgress: (p) => progress.push(p) });

  assert.equal(result.path, options.outputPath);
  assert.equal(sha256(readFileSync(options.outputPath)), result.hash);
  assert.equal(result.engine.host, "render-box");
  assert.equal(result.engine.sentFiles, 3);
  assert.equal(result.engine.concurrency, 3);
  assert.deepEqual(progress, [0.5, 1]);
  assert.ok(engine.calls.every((c) => c.destination === "someone@100.64.0.9"));
  assert.ok(engine.calls.some((c) => c.command.includes(`git checkout --quiet --force -B engine ${SHA}`)), "the commit was checked out");
  const rendered = engine.renders[0]!;
  assert.equal(rendered.cacheDir, path.join(engine.cache, "ch", "series", "ep1", "cache"), "the cache is the episode's own");
  assert.ok(logs.some((l) => /sending 3 file/.test(l)));

  // Again: the engine is synced and has every file, so only the render travels.
  engine.calls.length = 0;
  const again = await render(options);
  assert.equal(again.engine.sentFiles, 0);
  assert.ok(!engine.calls.some((c) => c.command.includes("git checkout")));
  assert.ok(!engine.calls.some((c) => / receive /.test(c.command)));
});

test("a file changed since the last render is sent again, the others are not", async () => {
  const { ep, options } = episode();
  const engine = fakeEngine();
  const render = remoteRenderer({ host: "render-box", key: "ch/series/ep1", exec: engine.exec, git: cleanGit, peers, env: {} });
  await render(options);
  const img = Buffer.from("new image");
  writeFileSync(path.join(ep, "media", "a.png"), img);
  const timeline = structuredClone(options.timeline) as { assets: Record<string, { hash: string }> };
  timeline.assets.img!.hash = sha256(img);
  const result = await render({ ...options, timeline });
  assert.equal(result.engine.sentFiles, 1);
});

test("bytes the engine holds under another path or another episode are copied there, not sent again", async () => {
  const first = episode();
  const engine = fakeEngine();
  const renderer = (key: string) => remoteRenderer({ host: "render-box", key, exec: engine.exec, git: cleanGit, peers, env: {} });
  assert.equal((await renderer("ch/series/ep1")(first.options)).engine.sentFiles, 3);

  // Another episode, elsewhere here, with the same picture and kit and one new sound.
  const second = episode();
  const sound = Buffer.from("a new sound");
  writeFileSync(path.join(second.ep, "media", "new.wav"), sound);
  const timeline = structuredClone(second.options.timeline) as { assets: Record<string, unknown> };
  timeline.assets.voice = { path: "media/new.wav", hash: sha256(sound), kind: "audio" };
  const logs: string[] = [];
  const result = await remoteRenderer({ host: "render-box", key: "ch/series/ep2", exec: engine.exec, git: cleanGit, peers, env: {}, onLog: (l) => logs.push(l) })({ ...second.options, timeline });
  assert.equal(result.engine.sentFiles, 1, "only the new sound travels");
  assert.equal(result.engine.sentBytes, sound.length);
  const copied = path.join(engine.cache, "ch", "series", "ep2", ...mirrorPath(path.join(second.ep, "media", "a.png")).split("/"));
  assert.deepEqual(readFileSync(copied), second.img);
  const index = JSON.parse(readFileSync(path.join(engine.cache, "ch", "series", "ep2", "index.json"), "utf-8")) as Record<string, { hash: string }>;
  assert.equal(index[mirrorPath(path.join(second.ep, "media", "a.png"))]!.hash, sha256(second.img), "the copy is indexed like a file received");

  // A held file changed since it was indexed is not trusted: it is sent.
  const third = episode();
  writeFileSync(path.join(engine.cache, "ch", "series", "ep1", ...mirrorPath(path.join(first.ep, "media", "a.png")).split("/")), "tampered!!!");
  writeFileSync(path.join(engine.cache, "ch", "series", "ep2", ...mirrorPath(path.join(second.ep, "media", "a.png")).split("/")), "tampered!!!");
  const again = await renderer("ch/series/ep3")(third.options);
  assert.equal(again.engine.sentFiles, 1, "the picture is sent; the sound and the kit are copied");
});

test("a render the engine refuses arrives as its error, problems included, and leaves no video", async () => {
  const { options } = episode();
  const engine = fakeEngine({
    render: async () => {
      throw Object.assign(new Error("the timeline cannot be rendered"), { code: "timeline-invalid", problems: [{ code: "timeline-invalid", message: "x", path: "$.tracks" }] });
    },
  });
  const render = remoteRenderer({ host: "render-box", key: "ch/series/ep1", exec: engine.exec, git: cleanGit, peers, env: {} });
  await assert.rejects(render(options), (e: Error & { code?: string; problems?: unknown[] }) => e.code === "timeline-invalid" && e.problems?.length === 1);
  assert.equal(existsSync(options.outputPath), false);
});

test("uncommitted render code stops the remote render before anything is sent", async () => {
  const { options } = episode();
  const engine = fakeEngine();
  const dirty: Git = (args) => (args[0] === "rev-parse" ? { code: 0, stdout: `${SHA}\n`, stderr: "" } : { code: 0, stdout: " M packages/remotion-composer/src/x.ts\n", stderr: "" });
  const render = remoteRenderer({ host: "render-box", key: "ch/series/ep1", exec: engine.exec, git: dirty, peers, env: {} });
  await assert.rejects(render(options), { code: "dirty-code" });
  assert.ok(engine.calls.every((c) => c.command.endsWith(" version")));
});

test("a machine without the engine code is bootstrapped by the push", async () => {
  const { options } = episode();
  const engine = fakeEngine();
  engine.noEngine.add("100.64.0.9");
  const render = remoteRenderer({ host: "render-box", key: "ch/series/ep1", exec: engine.exec, git: cleanGit, peers, env: {} });
  const result = await render(options);
  assert.equal(engine.state.synced, SHA);
  assert.ok(result.hash);
});

test("the engine's receive refuses bytes that are not what the header promised", async () => {
  const cache = tempDir();
  const header = `${JSON.stringify({ path: "files/x", size: 3, hash: sha256("abc") })}\nabd`;
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (b: Buffer) => chunks.push(b));
  const code = await runEngine(["receive", "a/b/c"], { stdin: Readable.from([Buffer.from(header)]), stdout: out, stderrLine: () => undefined }, { repo: "/nowhere", cache });
  assert.equal(code, 1);
  assert.match(Buffer.concat(chunks).toString(), /"code":"hash-mismatch"/);
  assert.equal(existsSync(path.join(cache, "a", "b", "c", "files", "x")), false);
  assert.equal(existsSync(path.join(cache, "a", "b", "c", "files", "x.part")), false);
});

test("the engine refuses keys and commands outside the protocol", async () => {
  const cache = tempDir();
  for (const argv of [["diff", "../../etc"], ["nonsense"], ["sync", "not-a-sha"]]) {
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on("data", (b: Buffer) => chunks.push(b));
    assert.equal(await runEngine(argv, { stdin: Readable.from([]), stdout: out, stderrLine: () => undefined }, { repo: "/nowhere", cache }), 1, argv.join(" "));
    assert.match(Buffer.concat(chunks).toString(), /"error"/);
  }
});

test("pinMismatches compares installed binaries with engine.env's pins", () => {
  const pins = { NODE_VERSION: "9.8.7", FFMPEG_FILE: "ffmpeg-n1.2.3-4-gabc-linux64-gpl-1.2", BUN_VERSION: "0.1.2" };
  assert.deepEqual(pinMismatches(pins, { node: "v9.8.7", ffmpeg: "ffmpeg version n1.2.3-4-gabc Copyright", bun: "0.1.2" }), []);
  assert.equal(pinMismatches(pins, { node: "v1.0.0", ffmpeg: null, bun: "0.1.3" }).length, 3);
  assert.deepEqual(pinMismatches({}, { node: "v1.0.0", ffmpeg: null, bun: null }), []);
});

test("a held file whose index no longer tells its bytes is not adopted: its copy is hashed", async () => {
  const first = episode();
  const engine = fakeEngine();
  const renderer = (key: string) => remoteRenderer({ host: "render-box", key, exec: engine.exec, git: cleanGit, peers, env: {} });
  await renderer("ch/series/ep1")(first.options);
  const held = path.join(engine.cache, "ch", "series", "ep1", ...mirrorPath(path.join(first.ep, "media", "a.png")).split("/"));
  writeFileSync(held, "X".repeat(first.img.length));
  // Its index still says the old hash for its size and modification time:
  // what a rewrite that puts the time back, or a coarse clock, leaves behind.
  const indexFile = path.join(engine.cache, "ch", "series", "ep1", "index.json");
  const index = JSON.parse(readFileSync(indexFile, "utf-8")) as Record<string, { size: number; mtimeMs: number; hash: string }>;
  index[mirrorPath(path.join(first.ep, "media", "a.png"))]!.mtimeMs = statSync(held).mtimeMs;
  writeFileSync(indexFile, JSON.stringify(index));

  const second = episode();
  const result = await renderer("ch/series/ep2")(second.options);
  assert.equal(result.engine.sentFiles, 1, "the picture travels: the bytes held are not the ones indexed");
  const copied = path.join(engine.cache, "ch", "series", "ep2", ...mirrorPath(path.join(second.ep, "media", "a.png")).split("/"));
  assert.deepEqual(readFileSync(copied), second.img);
});
