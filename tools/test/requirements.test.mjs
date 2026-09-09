import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { checkRequirements, hasBinary, resolveBinary } from "../requirements.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "readiness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "blender.mjs");
  await writeFile(binary, '#!/usr/bin/env node\nconsole.log("Blender 4.5.1");\n');
  await chmod(binary, 0o755);
  return { root, binary };
}
test("readiness respects BLENDER_BIN, version range and current environment", async t => {
  const { binary } = await fixture(t);
  const old = process.env.BLENDER_BIN;
  t.after(() => { if (old === undefined) delete process.env.BLENDER_BIN; else process.env.BLENDER_BIN = old; });
  process.env.BLENDER_BIN = binary;
  assert.equal(hasBinary("blender"), true);
  assert.deepEqual(checkRequirements({ requires: { system: ["blender"], env: ["AV_TEST_MISSING_CREDENTIAL_12345"] } }), [{ kind: "env", name: "AV_TEST_MISSING_CREDENTIAL_12345" }]);
  for (const [version, supported] of [["5.0.0", false], ["5.2.1 LTS", true], ["5.3.0", false]]) {
    await writeFile(binary, `#!/usr/bin/env node\nconsole.log('Blender ${version}');\n`);
    assert.equal(hasBinary("blender"), supported, version);
  }
});
test("FFmpeg overrides apply only to adapters that honour them", t => {
  const old = process.env.FFMPEG_BIN;
  t.after(() => { if (old === undefined) delete process.env.FFMPEG_BIN; else process.env.FFMPEG_BIN = old; });
  process.env.FFMPEG_BIN = "/custom/ffmpeg";
  assert.equal(resolveBinary("ffmpeg", { path: "packages/blender" }), "/custom/ffmpeg");
  assert.equal(resolveBinary("ffmpeg", { path: "packages/video-composer" }), "ffmpeg");
});
test("doctor rechecks snapshot readiness without rewriting composition", async t => {
  const { root, binary } = await fixture(t);
  await mkdir(join(root, "tools"));
  await mkdir(join(root, "packages", "blender"), { recursive: true });
  for (const name of ["doctor.mjs", "requirements.mjs"]) {
    await copyFile(new URL(`../${name}`, import.meta.url), join(root, "tools", name));
  }
  const composed = { profile: "test", components: [{ name: "blender", path: "packages/blender", present: true, ready: false, missing: [{ kind: "system", name: "blender" }] }],
    capabilities: { "scene.render": { provider: "blender", ready: false, providers: [{ name: "blender", ready: false }] } } };
  await writeFile(join(root, "composed.json"), JSON.stringify(composed));
  await writeFile(join(root, "compose.config.json"), JSON.stringify({ components: { blender: { path: "packages/blender", requires: { system: ["blender"] } } } }));
  const doctor = spawnSync(process.execPath, [join(root, "tools", "doctor.mjs")], { encoding: "utf8", env: { ...process.env, BLENDER_BIN: binary } });
  assert.match(doctor.stdout, /✓ scene\.render/);
  const missing = spawnSync(process.execPath, [join(root, "tools", "doctor.mjs")], { encoding: "utf8", env: { ...process.env, BLENDER_BIN: join(root, "absent") } });
  assert.match(missing.stdout, /! scene\.render/);
  assert.match(missing.stdout, /needs system blender/);
  assert.deepEqual(JSON.parse(await readFile(join(root, "composed.json"), "utf8")), composed);
});
