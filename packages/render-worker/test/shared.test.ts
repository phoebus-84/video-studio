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
import { runsOf, sharedRenderer, type SharedRendererOptions, type SharedRenderResult } from "../src/shared.js";
import { readSpeeds, recordSpeeds, splitByWeight, weightsFor } from "../src/speeds.js";
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

/** Who drew each second of an assembled video, in order. */
function drawnBy(file: string) {
  return [...readFileSync(file, "utf-8").matchAll(/\[segment (\d+) by ([\w-]+)( \+audio)?\]/g)].map(([, i, by, audio]) => ({ i: Number(i), by, audio: Boolean(audio) }));
}

/** fakeDraw that takes `ms` a chunk, so the engines here get some of the queue. */
function slowDraw(name: string, ms: number): SharedRendererOptions["draw"] {
  const draw = fakeDraw(name);
  return async (o) => {
    await new Promise((r) => setTimeout(r, ms));
    return draw(o);
  };
}

/** Every second once, in order; each by the machine whose share holds it; the soundtrack warmed only on the assembler. */
function assertAssembled(file: string, shares: SharedRenderResult["engine"]["shares"], assembler: string) {
  const drawn = drawnBy(file);
  assert.deepEqual(drawn.map((d) => d.i), [0, 1, 2, 3, 4]);
  for (const d of drawn) {
    const share = shares.find((s) => s.runs.some(([a, b]) => a <= d.i && d.i <= b));
    assert.equal(share?.host, d.by, `segment ${d.i}`);
    if (d.audio) assert.equal(d.by, assembler, `segment ${d.i} warmed the soundtrack off the assembler`);
  }
  assert.equal(shares.reduce((n, s) => n + s.segments, 0), 5);
}

test("a share here and one on an engine, assembled here", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  const progress: number[] = [];
  const result = await renderer(exec, { hosts: ["local", "box-a"], draw: slowDraw("local", 150) })({ ...options, onProgress: (p) => progress.push(p) });

  assertAssembled(path.join(ep, "out.mp4"), result.engine.shares, "local");
  const drawn = drawnBy(path.join(ep, "out.mp4"));
  assert.ok(drawn[0]!.audio && drawn[0]!.by === "local", "the first chunk here warms the soundtrack");
  assert.ok(drawn.some((d) => d.by === "box-a"), "the engine helps");
  assert.ok(engines.get("box-a")!.draws.every((d) => !d.audio));
  assert.equal(engines.get("box-a")!.renders.length, 0, "the engine only draws");
  const commands = engines.get("box-a")!.calls.map((c) => c.command);
  assert.equal(commands.filter((c) => / draw ch\/series\/ep1$/.test(c)).length, 1, "every chunk goes through one draw session");
  assert.ok(!commands.some((c) => / render /.test(c)));
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

  assertAssembled(path.join(ep, "out.mp4"), result.engine.shares, "box-b");
  assert.equal(engines.get("box-b")!.renders.length, 1, "box-b assembles");
  assert.deepEqual(Object.keys(engines.get("box-b")!.renders[0]!.drawn ?? {}).map(Number).sort(), [0, 1, 2, 3, 4]);
  assert.equal(engines.get("box-a")!.renders.length + engines.get("box-c")!.renders.length, 0);
  for (const name of NAMES) {
    const sessions = engines.get(name)!.calls.filter((c) => / draw ch\/series\/ep1$/.test(c.command)).length;
    assert.ok(sessions <= 1, `${name} opened ${sessions} draw sessions`);
  }
  assert.equal(result.engine.host, "box-b");
  assert.equal(result.engine.commit, SHA);
});

test("an assembler that draws nothing gets the files and everyone's segments", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  const result = await renderer(exec, { hosts: ["local", "box-a"], assembleOn: "box-c", draw: slowDraw("local", 150) })(options);

  assertAssembled(path.join(ep, "out.mp4"), result.engine.shares, "box-c");
  assert.ok(drawnBy(path.join(ep, "out.mp4")).some((d) => d.by === "box-a"));
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

test("a faster machine starts with more, and a share's speed is kept when it drew enough to measure", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  const speedsFile = path.join(tempDir("rw-speeds-"), "render-speeds.json");
  writeFileSync(speedsFile, JSON.stringify({ speeds: { "box-a": { segmentsPerSecond: 3, samples: 1, updatedAt: "x" }, "box-b": { segmentsPerSecond: 1, samples: 1, updatedAt: "x" } } }));
  const result = await renderer(exec, { hosts: ["box-a", "box-b"], speedsFile })(options);
  assertAssembled(path.join(ep, "out.mp4"), result.engine.shares, "box-a");
  assert.deepEqual(engines.get("box-a")!.draws[0]!.segments, [0, 1], "half its fair part, from the front");
  assert.deepEqual(engines.get("box-b")!.draws[0]!.segments, [4], "no more than it draws before box-a would finish");
  const kept = readSpeeds(speedsFile);
  for (const s of result.engine.shares) assert.equal(kept[s.host]!.samples, s.segments >= 3 ? 2 : 1, s.host);
});

test("a speed in render-hosts.json sizes the first chunks", async () => {
  const { options } = episode();
  const { engines, exec } = machines();
  await renderer(exec, { hosts: ["box-a", "box-b"], config: { hosts: { "Box-A": { address: "100.64.0.10", speed: 1 }, "box-b": { address: "100.64.0.11", speed: 4 } } } })(options);
  assert.deepEqual(engines.get("box-a")!.draws[0]!.segments, [0]);
  assert.deepEqual(engines.get("box-b")!.draws[0]!.segments, [3, 4]);
});

test("splitByWeight: contiguous counts by weight, at least one each", () => {
  assert.deepEqual(splitByWeight(20, [1, 1]), [10, 10]);
  assert.deepEqual(splitByWeight(20, [10 / 56, 10 / 67]), [11, 9]);
  assert.deepEqual(splitByWeight(10, [100, 1, 1]), [8, 1, 1]);
  assert.deepEqual(splitByWeight(2, [1, 1, 1]), [1, 1]);
  assert.deepEqual(splitByWeight(7, [2, 1, 1]).reduce((a, b) => a + b, 0), 7);
});

test("runsOf: neighbouring segments as runs", () => {
  assert.deepEqual(runsOf([5, 0, 1, 2, 7, 6]), [[0, 2], [5, 7]]);
  assert.deepEqual(runsOf([3]), [[3, 3]]);
  assert.deepEqual(runsOf([]), []);
});

test("weightsFor and recordSpeeds: configured, then measured, then the average", () => {
  const speeds = { a: { segmentsPerSecond: 2, samples: 1, updatedAt: "x" } };
  assert.deepEqual(weightsFor(["a", "b", "c"], ["a", "b", "c"], speeds, { hosts: { c: { address: "x", speed: 6 } } }), [2, 4, 6]);
  assert.deepEqual(weightsFor(["a", "b"], ["a", "b"], {}, {}), [1, 1]);
  const file = path.join(tempDir("rw-speeds-"), "s.json");
  recordSpeeds(file, [{ key: "a", segments: 10, seconds: 5 }, { key: "b", segments: 2, seconds: 3 }], new Date(0));
  recordSpeeds(file, [{ key: "a", segments: 10, seconds: 2.5 }], new Date(0));
  assert.deepEqual(readSpeeds(file), { a: { segmentsPerSecond: 3, samples: 2, updatedAt: new Date(0).toISOString() } });
});

test("an engine that cannot start draws nothing, and the others draw its part", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  engines.get("box-a")!.unreachable.add("someone@100.64.0.10");
  const lines: string[] = [];
  const result = await renderer(exec, { hosts: ["local", "box-a"], onLog: (l) => lines.push(l) })(options);
  assert.deepEqual(drawnBy(path.join(ep, "out.mp4")).map((d) => d.by), ["local", "local", "local", "local", "local"]);
  assert.equal(result.engine.shares.find((s) => s.host === "box-a")?.segments ?? 0, 0);
  assert.ok(lines.some((l) => l.includes("box-a does not draw")), lines.join(" | "));
});

test("an engine that fails a chunk gives it back, and the others draw it", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  engines.get("box-a")!.failAfter = 1;
  const lines: string[] = [];
  const result = await renderer(exec, { hosts: ["local", "box-a"], draw: slowDraw("local", 150), onLog: (l) => lines.push(l) })(options);
  const drawn = drawnBy(path.join(ep, "out.mp4"));
  assert.deepEqual(drawn.map((d) => d.i), [0, 1, 2, 3, 4], "no second is missing");
  assert.ok(drawn.some((d) => d.by === "box-a"), "its first chunk is kept");
  assert.ok(lines.some((l) => /box-a failed on .*the others draw them/.test(l)), lines.join(" | "));
  assert.equal(result.engine.shares.find((s) => s.host === "box-a")?.segments, engines.get("box-a")!.draws[0]!.segments.length);
});

test("a machine that has finished still draws what a failing one gives back", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  engines.get("box-a")!.failAfter = 0;
  // box-a holds its chunk while local finishes the rest, then fails it.
  const slow: Exec = async (destination, command, input) => {
    if (command.includes(" draw ")) await new Promise((r) => setTimeout(r, 300));
    return exec(destination, command, input);
  };
  const result = await renderer(slow, { hosts: ["local", "box-a"] })(options);
  assert.deepEqual(drawnBy(path.join(ep, "out.mp4")).map((d) => [d.i, d.by]), [0, 1, 2, 3, 4].map((i) => [i, "local"]));
  assert.equal(result.engine.shares.find((s) => s.host === "box-a")?.segments ?? 0, 0);
});

test("an assembler that cannot start fails the render and leaves nothing behind", async () => {
  const { options } = episode();
  const { engines, exec } = machines();
  engines.get("box-a")!.unreachable.add("someone@100.64.0.10");
  await assert.rejects(renderer(exec, { hosts: ["local", "box-a"], assembleOn: "box-a" })(options));
  assert.ok(!existsSync(options.outputPath));
  assert.ok(!existsSync(`${options.outputPath}.shared`));
});

test("a segment that changed on the way is refused, and drawn again by another machine", async () => {
  const { ep, options } = episode();
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
  const lines: string[] = [];
  await renderer(tamper, { hosts: ["local", "box-a"], draw: slowDraw("local", 150), onLog: (l) => lines.push(l) })(options);
  assert.ok(lines.some((l) => /box-a failed on .*not what it drew/.test(l)), lines.join(" | "));
  assert.deepEqual(drawnBy(path.join(ep, "out.mp4")).map((d) => [d.i, d.by]), [0, 1, 2, 3, 4].map((i) => [i, "local"]));
});

test("an engine draws its next chunk while the last one travels here", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  const boxA = engines.get("box-a")!;
  const overlapped: boolean[] = [];
  const slowPull: Exec = async (destination, command, input) => {
    if (!command.includes("send-drawn")) return exec(destination, command, input);
    const before = boxA.draws.length;
    await new Promise((r) => setTimeout(r, 250));
    const run = await exec(destination, command, input);
    overlapped.push(boxA.draws.length > before);
    return run;
  };
  const result = await renderer(slowPull, { hosts: ["local", "box-a"], draw: slowDraw("local", 600) })(options);
  assert.ok(boxA.draws.length >= 2, `box-a drew ${boxA.draws.length} chunks`);
  assert.ok(overlapped[0], "box-a waited for its first chunk to arrive before drawing the next");
  assertAssembled(path.join(ep, "out.mp4"), result.engine.shares, "local");
});

test("a chunk that fails on its way here goes back to the others, with those behind it", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  const boxA = engines.get("box-a")!;
  const brokenPull: Exec = async (destination, command, input) => {
    if (command.includes("send-drawn")) {
      await new Promise((r) => setTimeout(r, 100));
      return { code: 1, stdout: "", stderr: "connection reset" };
    }
    return exec(destination, command, input);
  };
  const lines: string[] = [];
  const result = await renderer(brokenPull, { hosts: ["local", "box-a"], draw: slowDraw("local", 150), onLog: (l) => lines.push(l) })(options);
  assert.ok(boxA.draws.length >= 1);
  assert.ok(lines.some((l) => /box-a failed on .*the others draw them/.test(l)), lines.join(" | "));
  assert.deepEqual(drawnBy(path.join(ep, "out.mp4")).map((d) => [d.i, d.by]), [0, 1, 2, 3, 4].map((i) => [i, "local"]));
  assert.equal(result.engine.shares.find((s) => s.host === "box-a")?.segments ?? 0, 0);
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

test("a draw session prepares the job once and answers each chunk on its own line", async () => {
  const cache = tempDir();
  const job = JSON.stringify({ version: 1, timeline: {}, assetRoot: "files/x", sharedRoots: [], kits: [] });
  const opened: string[] = [];
  const chunks: { segments: number[]; audio?: boolean }[] = [];
  const out = new PassThrough();
  const answers: Buffer[] = [];
  out.on("data", (b: Buffer) => answers.push(b));
  const code = await runEngine(["draw", "a/b/c"], {
    stdin: Readable.from([`${job}\n{"segments":[0,1],"audio":true}\n`, `{"segments":[4]}\n`]),
    stdout: out,
    stderrLine: () => undefined,
  }, {
    repo: "/nowhere",
    cache,
    openDrawer: async (o) => {
      opened.push(o.dir);
      return {
        draw: async (chunk) => {
          chunks.push({ segments: chunk.segments, ...(chunk.audio ? { audio: true } : {}) });
          return { segments: chunk.segments.map((index) => ({ index, file: "", hash: sha256(String(index)), bytes: 1 })), totalSegments: 5, cache: { segmentsRendered: chunk.segments.length } } as never;
        },
        close: async () => {
          opened.push("closed");
        },
      };
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(opened, [path.join(cache, "a", "b", "c", "drawn"), "closed"]);
  assert.deepEqual(chunks, [{ segments: [0, 1], audio: true }, { segments: [4] }]);
  const lines = Buffer.concat(answers).toString().trim().split("\n").map((l) => JSON.parse(l) as { segments: { index: number }[]; rendered: number });
  assert.deepEqual(lines.map((l) => l.segments.map((s) => s.index)), [[0, 1], [4]]);
  assert.deepEqual(lines.map((l) => l.rendered), [2, 1]);
  assert.ok(!existsSync(path.join(cache, "a", "b", "c", "render.lock")), "the lock goes with the session");
});

test("a correction: cached seconds are not drawn, and a few missing ones are drawn here alone", async () => {
  const { ep, options } = episode();
  const { engines, exec } = machines();
  const result = await renderer(exec, { hosts: ["local", "box-a"], cached: async () => [0, 1, 2] })(options);

  assert.deepEqual(drawnBy(path.join(ep, "out.mp4")).map((d) => [d.i, d.by]), [[3, "local"], [4, "local"]]);
  assert.equal(engines.get("box-a")!.draws.length, 0, "no engine waited on for two seconds");
  assert.equal(result.engine.shares.reduce((n, s) => n + s.segments, 0), 2);
});
