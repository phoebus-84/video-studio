// sharedRenderer end to end: shares drawn here and on engines running in this
// process (helpers.ts), assembled here or on one of them.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PassThrough, Readable } from "node:stream";
import type { RenderTimelineOptions } from "@av/remotion-composer";
import type { Git } from "../src/code-sync.js";
import { runEngine } from "../src/engine.js";
import { drawnPath } from "../src/protocol.js";
import { sharedRenderer, type SharedRendererOptions } from "../src/shared.js";
import type { Exec } from "../src/ssh.js";
import { fakeDraw, fakeEngine, fakeRender, sha256, tempDir, type FakeEngine } from "./helpers.js";

const SHA = "b".repeat(40);
const cleanGit: Git = (args) => (args[0] === "rev-parse" ? { code: 0, stdout: `${SHA}\n`, stderr: "" } : { code: 0, stdout: "", stderr: "" });
const NAMES = ["box-a", "box-b", "box-c"];
const peers = NAMES.map((name, i) => ({ name, dnsName: null, addresses: [`100.64.0.${10 + i}`], online: true, os: "linux" }));

/** One engine per machine, each with its own cache, behind one Exec. */
function machines() {
  const engines = new Map<string, FakeEngine>(NAMES.map((name) => [name, fakeEngine({ name })]));
  const exec: Exec = (destination, command, input) => {
    const i = peers.findIndex((p) => destination.endsWith(p.addresses[0]!));
    assert.ok(i >= 0, `no machine at ${destination}`);
    return engines.get(NAMES[i]!)!.exec(destination, command, input);
  };
  return { engines, exec };
}

/** A five-second episode with one image. */
function episode() {
  const root = tempDir("rw-shared-");
  const ep = path.join(root, "ch", "series", "ep1");
  mkdirSync(path.join(ep, "media"), { recursive: true });
  const img = Buffer.from("image bytes");
  writeFileSync(path.join(ep, "media", "a.png"), img);
  const options: RenderTimelineOptions = {
    timeline: { durationInFrames: 150, fps: 30, assets: { img: { path: "media/a.png", hash: sha256(img), kind: "image" } } },
    assetRoot: ep,
    sharedRoots: [],
    kits: [],
    outputPath: path.join(ep, "out.mp4"),
    cacheDir: path.join(ep, ".cache", "remotion"),
  };
  return { ep, options, img };
}

function renderer(exec: Exec, options: Partial<SharedRendererOptions> & { hosts: string[] }) {
  return sharedRenderer({
    key: "ch/series/ep1", exec, git: cleanGit, peers, config: {}, env: { AVG_RENDER_SSH_USER: "someone" },
    draw: fakeDraw("local"), renderLocal: fakeRender, ...options,
  });
}

const segment = (i: number, by: string, audio = false) => `[segment ${i} by ${by}${audio ? " +audio" : ""}]`;

test("a share here and one on an engine, assembled here", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  const progress: number[] = [];
  const result = await renderer(exec, { hosts: ["local", "box-a"] })({ ...options, onProgress: (p) => progress.push(p) });

  assert.equal(readFileSync(path.join(ep, "out.mp4"), "utf-8"),
    `MP4:image bytes${segment(0, "local", true)}${segment(1, "local", true)}${segment(2, "box-a")}${segment(3, "box-a")}${segment(4, "box-a")}`);
  assert.deepEqual(engines.get("box-a")!.draws.map((d) => [d.segments, d.audio]), [[[2, 3, 4], false]]);
  assert.equal(engines.get("box-a")!.renders.length, 0, "the engine only draws");
  assert.deepEqual(result.engine.shares.map((s) => [s.host, s.from, s.to]), [["local", 0, 1], ["box-a", 2, 4]]);
  assert.equal(result.engine.assembler, "local");
  assert.equal(result.engine.sentFiles, 1);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]! - 1e-9), "progress only goes forward");
  assert.ok(!existsSync(`${options.outputPath}.shared`), "the shared folder is gone");
});

test("three engines, one of them assembles: the others' segments reach it through here", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  const result = await renderer(exec, { hosts: ["box-a", "box-b", "box-c"], assembleOn: "box-b" })(options);

  assert.equal(readFileSync(path.join(ep, "out.mp4"), "utf-8"),
    `MP4:image bytes${segment(0, "box-a")}${segment(1, "box-b", true)}${segment(2, "box-b", true)}${segment(3, "box-c")}${segment(4, "box-c")}`);
  assert.equal(engines.get("box-b")!.renders.length, 1, "box-b assembles");
  assert.deepEqual(Object.keys(engines.get("box-b")!.renders[0]!.drawn ?? {}).map(Number).sort(), [0, 1, 2, 3, 4]);
  assert.equal(engines.get("box-a")!.renders.length + engines.get("box-c")!.renders.length, 0);
  assert.equal(result.engine.host, "box-b");
  assert.equal(result.engine.commit, SHA);
  assert.deepEqual(result.engine.shares.map((s) => [s.host, s.segments]), [["box-a", 1], ["box-b", 2], ["box-c", 2]]);
});

test("an assembler that draws nothing gets the files and everyone's segments", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  await renderer(exec, { hosts: ["local", "box-a"], assembleOn: "box-c" })(options);

  assert.equal(readFileSync(path.join(ep, "out.mp4"), "utf-8"),
    `MP4:image bytes${segment(0, "local")}${segment(1, "local")}${segment(2, "box-a")}${segment(3, "box-a")}${segment(4, "box-a")}`);
  assert.equal(engines.get("box-c")!.draws.length, 0);
  assert.equal(engines.get("box-c")!.renders.length, 1);
});

test("more machines than seconds: the extra ones draw nothing", async () => {
  const { options } = episode();
  const { engines, exec } = machines();
  const short = { ...options, timeline: { ...(options.timeline as object), durationInFrames: 45 } };
  const result = await renderer(exec, { hosts: ["box-a", "box-b", "box-c"] })(short);
  assert.deepEqual(result.engine.shares.map((s) => s.host), ["box-a", "box-b"]);
  assert.equal(engines.get("box-c")!.calls.length, 0);
});

test("a failed share fails the render and leaves nothing behind", async () => {
  const { options } = episode();
  const { engines, exec } = machines();
  engines.get("box-a")!.unreachable.add("someone@100.64.0.10");
  await assert.rejects(renderer(exec, { hosts: ["local", "box-a"] })(options));
  assert.ok(!existsSync(options.outputPath));
  assert.ok(!existsSync(`${options.outputPath}.shared`));
});

test("a segment that changed on the way is refused", async () => {
  const { options } = episode();
  const { exec } = machines();
  const tamper: Exec = async (destination, command, input) => {
    const run = await exec(destination, command, input);
    if (command.includes("send-drawn") && input?.stdout) {
      // The bundle went to a file; spoil it after the fact.
      const file = (input.stdout as unknown as { path: string }).path;
      await new Promise((r) => setTimeout(r, 10));
      const bytes = readFileSync(file);
      writeFileSync(file, Buffer.from(bytes.toString("utf-8").replace("by box-a", "by box-x")));
    }
    return run;
  };
  await assert.rejects(renderer(tamper, { hosts: ["local", "box-a"] })(options), /not what it drew/);
});

test("names are checked before anything runs", () => {
  assert.throws(() => sharedRenderer({ key: "a/b/c", hosts: [] }), /at least one machine/);
  assert.throws(() => sharedRenderer({ key: "a/b/c", hosts: ["auto"] }), /names its machines/);
});

/** One engine command in this process; its exit code and stdout. */
async function engineRun(argv: string[], cache: string, stdin: string | Buffer) {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (b: Buffer) => chunks.push(b));
  const code = await runEngine(argv, { stdin: Readable.from([Buffer.from(stdin)]), stdout: out, stderrLine: () => undefined }, { repo: "/nowhere", cache });
  return { code, stdout: Buffer.concat(chunks).toString() };
}

test("the engine keeps drawn segments under drawn/ and checks them before assembling", async () => {
  const cache = tempDir();
  const bytes = "[segment 0]";
  const bundle = `${JSON.stringify({ path: drawnPath(0), size: bytes.length, hash: sha256(bytes) })}
${bytes}`;
  assert.equal((await engineRun(["receive-drawn", "a/b/c"], cache, bundle)).code, 0);
  assert.equal(readFileSync(path.join(cache, "a", "b", "c", "drawn", "segment-0.mp4"), "utf-8"), bytes);

  const outside = `${JSON.stringify({ path: "files/x", size: 1, hash: sha256("x") })}
x`;
  assert.match((await engineRun(["receive-drawn", "a/b/c"], cache, outside)).stdout, /"code":"bad-path"/);

  assert.match((await engineRun(["send-drawn", "a/b/c"], cache, "[1]")).stdout, /"code":"missing-file"/);

  const job = (drawn: Record<string, string>) => JSON.stringify({ version: 1, timeline: {}, assetRoot: "files/x", sharedRoots: [], kits: [], drawn });
  assert.match((await engineRun(["render", "a/b/c"], cache, job({ 0: sha256("other") }))).stdout, /"code":"hash-mismatch"/);
  assert.match((await engineRun(["render", "a/b/c"], cache, job({ 1: sha256(bytes) }))).stdout, /"code":"missing-file"/);
});
