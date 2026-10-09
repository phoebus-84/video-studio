// ---------------------------------------------------------------------------
// `vpr template seal` and `vpr template verify` (avg-d1x): a release's own
// compiler and validator, built into it and checked against its fixtures.
// Spawns the compiled CLI, like cli.test.ts.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { specEpisode } from "@studio/episode/testing";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/src/cli.js");
const require = createRequire(import.meta.url);
const CODE = path.dirname(path.dirname(require.resolve("@studio/series/fixtures/release-code/poetry-short/compiler/index.ts")));
const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** A library whose poetry-short release holds its own code, no episode pinning it. */
function library() {
  const root = mkdtempSync(path.join(tmpdir(), "cli-template-code-"));
  roots.push(root);
  const episodeDir = path.join(root, "sample", "series", "poetry", "episodes", "morning");
  specEpisode(episodeDir, { channel: "sample", series: "poetry", episode: "morning" });
  rmSync(path.join(episodeDir, "episode-spec.json"));
  const release = path.join(root, "sample", "series", "poetry", "templates", "poetry-short", "1.0.0");
  cpSync(CODE, release, { recursive: true });
  return { root, release };
}

function vpr(root: string, args: string[]) {
  const result = spawnSync("node", [cliPath, "template", ...args, "--library", root, "--json"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status ?? 1, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

describe("vpr template seal / verify", () => {
  it("seals the release's code, then verifies it against its fixtures", () => {
    const { root, release } = library();
    const sealed = vpr(root, ["seal", "sample/poetry", "poetry-short", "1.0.0"]);
    expect(sealed.status, sealed.stderr).toBe(0);
    expect(sealed.json.code.compiler.path).toBe("compiler/compiler.cjs");
    const manifest = JSON.parse(readFileSync(path.join(release, "series-template.json"), "utf-8"));
    expect(manifest.validator.bundle.hash).toBe(sealed.json.code.validator.hash);

    mkdirSync(path.join(release, "fixtures", "morning"), { recursive: true });
    cpSync(INPUT, path.join(release, "fixtures", "morning", "input.json"));
    expect(vpr(root, ["verify", "sample/poetry", "poetry-short", "1.0.0"]).status).toBe(2); // no golden yet
    expect(vpr(root, ["verify", "sample/poetry", "poetry-short", "1.0.0", "--update"]).status).toBe(0);
    const verified = vpr(root, ["verify", "sample/poetry", "poetry-short", "1.0.0"]);
    expect([verified.status, verified.json.ok, verified.json.fixtures]).toEqual([0, true, [{ name: "morning", ok: true }]]);

    appendFileSync(path.join(release, "compiler", "index.ts"), "\nexport const extra = 1;\n");
    const changed = vpr(root, ["verify", "sample/poetry", "poetry-short", "1.0.0"]);
    expect([changed.status, changed.json.problems[0].code]).toEqual([2, "source-differs"]);
  });

  it("refuses to seal a release an episode pins, as a runtime error", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cli-template-code-"));
    roots.push(root);
    specEpisode(path.join(root, "sample", "series", "poetry", "episodes", "morning"), { channel: "sample", series: "poetry", episode: "morning" });
    cpSync(CODE, path.join(root, "sample", "series", "poetry", "templates", "poetry-short", "1.0.0"), { recursive: true });
    const refused = vpr(root, ["seal", "sample/poetry", "poetry-short", "1.0.0"]);
    expect([refused.status, refused.json.code]).toEqual([2, "release-pinned"]);
  });
});
