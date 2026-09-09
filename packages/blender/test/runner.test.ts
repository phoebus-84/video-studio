import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probe, runBlender, settingsFor } from "../src/index.js";
import { runProcess } from "../src/process.js";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "blender test "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "fake blender.mjs");
  await writeFile(binary, `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) { console.log('Blender 4.5.1'); process.exit(0); }
if (!process.argv.includes('--disable-autoexec') || !process.argv.includes('--python-exit-code')) process.exit(8);
const cfg = JSON.parse(readFileSync(process.argv.at(-1), 'utf8'));
const source = cfg.scriptPath ? readFileSync(cfg.scriptPath, 'utf8') : '';
if (source.includes('FAIL')) process.exit(3);
if (source.includes('NO_OUTPUT')) process.exit(0);
writeFileSync(join(cfg.outputDir, 'scene.blend'), 'BLENDER fake');
writeFileSync(join(cfg.outputDir, 'scene-info.json'), JSON.stringify({ camera: 'Camera', engine: cfg.settings.engine }));
if (cfg.mode === 'preview') writeFileSync(join(cfg.outputDir, 'preview.png'), 'png');
if (cfg.mode === 'animation') {
 mkdirSync(join(cfg.outputDir, 'frames'));
 for(let i=cfg.settings.frameStart;i<=cfg.settings.frameEnd;i++) writeFileSync(join(cfg.outputDir, 'frames', String(i).padStart(6,'0')+'.png'), 'png');
}
`);
  await chmod(binary, 0o755);
  const ffmpeg = join(root, "fake ffmpeg.mjs");
  await writeFile(ffmpeg, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv.at(-1), 'mp4');
`);
  await chmod(ffmpeg, 0o755);
  const scriptPath = join(root, "scene 'quoted'.py");
  await writeFile(scriptPath, "# reviewed script\n");
  return { root, scriptPath, options: { blenderPath: binary, ffmpegPath: ffmpeg }, binary };
}
test("probe accepts tested version families and rejects unknown ones", async t => {
  const f = await fixture(t);
  for (const [version, supported] of [["4.2.0", true], ["4.5.1", true], ["5.2.1 LTS", true], ["4.1.0", false], ["5.0.0", false], ["5.3.0", false], ["6.0.0", false]] as const) {
    await writeFile(f.binary, `#!/usr/bin/env node\nconsole.log('Blender ${version}');\n`);
    assert.equal(probe(f.binary).available, supported, version);
  }
});
test("settings reject invalid ranges, budgets and devices before launch", () => {
  assert.equal(settingsFor().engine, "eevee");
  for (const settings of [{ frameStart: 4, frameEnd: 3 }, { width: 641 }, { fps: NaN },
    { frameEnd: 10001 }, { samples: -1 }, { device: "metal" as const }]) {
    assert.throws(() => settingsFor(settings));
  }
});
test("create → preview → animation preserves input, settings and provenance", async t => {
  const f = await fixture(t);
  assert.equal(probe(f.binary).available, true);
  const create = await runBlender({ mode: "create", outputDir: join(f.root, "create"), scriptPath: f.scriptPath, trustedInput: true }, f.options);
  assert.equal(create.frameCount, 0);
  assert.equal(await readFile(join(create.outputDir, "source.py"), "utf8"), "# reviewed script\n");
  const manifest = JSON.parse(await readFile(create.manifestPath, "utf8"));
  assert.equal(manifest.status, "completed");
  assert.match(manifest.scriptSha256, /^[0-9a-f]{64}$/);
  const preview = await runBlender({ mode: "preview", outputDir: join(f.root, "preview"), blendPath: create.blendPath, trustedInput: true }, f.options);
  assert.match(preview.mediaPath!, /preview\.png$/);
  const animation = await runBlender({ mode: "animation", outputDir: join(f.root, "animation"), blendPath: create.blendPath, trustedInput: true,
    settings: { engine: "cycles", frameStart: 8, frameEnd: 10 } }, f.options);
  assert.equal(animation.frameCount, 3);
  assert.match(animation.mediaPath!, /animation\.mp4$/);
  assert.equal(JSON.parse(await readFile(animation.manifestPath, "utf8")).settings.engine, "cycles");
  await assert.rejects(runBlender({ mode: "create", outputDir: create.outputDir, scriptPath: f.scriptPath, trustedInput: true }, f.options), /EEXIST/);
});
test("untrusted input and missing inputs never start a job", async t => {
  const f = await fixture(t);
  await assert.rejects(runBlender({ mode: "create", outputDir: join(f.root, "bad"), scriptPath: f.scriptPath, trustedInput: false }, f.options), /NOT sandboxed/);
  await assert.rejects(runBlender({ mode: "animation", outputDir: join(f.root, "bad"), trustedInput: true }, f.options), /requires/);
});
test("Python errors, missing binary and false success persist failed attempts", async t => {
  const f = await fixture(t);
  for (const source of ["FAIL", "NO_OUTPUT"]) {
    await writeFile(f.scriptPath, source);
    const dir = join(f.root, source);
    await assert.rejects(runBlender({ mode: "create", outputDir: dir, scriptPath: f.scriptPath, trustedInput: true }, f.options), /attempt:/);
    assert.equal(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")).status, "failed");
  }
  await assert.rejects(runBlender({ mode: "create", outputDir: join(f.root, "missing"), scriptPath: f.scriptPath, trustedInput: true }, { blenderPath: join(f.root, "absent") }), /ENOENT/);
});
test("asynchronous subprocesses honour cancellation and deadline", async t => {
  const f = await fixture(t);
  const abort = new AbortController();
  const common = { cwd: f.root, logPath: join(f.root, "process.log"), timeoutMs: 5000 };
  const job = runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { ...common, signal: abort.signal });
  setTimeout(() => abort.abort(), 100);
  await assert.rejects(job, /cancelled/);
  await assert.rejects(runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { ...common, timeoutMs: 50 }), /exceeded/);
  const done = new AbortController(); done.abort();
  await assert.rejects(runProcess(process.execPath, [], { ...common, signal: done.signal }));
});
test("parallel calls cannot claim the same attempt", async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, "parent"));
  const req = { mode: "create" as const, outputDir: join(f.root, "parent", "attempt"), scriptPath: f.scriptPath, trustedInput: true };
  const results = await Promise.allSettled([runBlender(req, f.options), runBlender(req, f.options)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
});
