// ---------------------------------------------------------------------------
// `vpr kit seal` and `vpr kit verify` (avg-d1x): a kit the channel carries,
// built and checked. Spawns the compiled CLI, like cli.test.ts.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/src/cli.js");
const require = createRequire(import.meta.url);
const KIT = path.dirname(require.resolve("@studio/series/fixtures/release-code/sample-card/kit/index.tsx"));

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function vpr(root: string, args: string[]) {
  const result = spawnSync("node", [cliPath, "kit", ...args, "--library", root, "--json"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status ?? 1, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

// Each test spawns the CLI and builds with esbuild: seconds, not milliseconds.
describe("vpr kit seal / verify", { timeout: 60_000 }, () => {
  it("seals the channel's kit, then verifies it and its examples", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cli-kit-"));
    roots.push(root);
    const kitDir = path.join(root, "sample", "kits", "sample-card", "1.0.0");
    cpSync(KIT, path.join(kitDir, "kit"), { recursive: true });

    const dry = vpr(root, ["seal", "sample", "sample-card", "1.0.0", "--dry-run"]);
    expect([dry.status, existsSync(path.join(kitDir, "kit.json"))]).toEqual([0, false]);
    const sealed = vpr(root, ["seal", "sample", "sample-card", "1.0.0"]);
    expect(sealed.status, sealed.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(kitDir, "kit.json"), "utf-8")).bundle.hash).toBe(sealed.json.bundle.hash);

    const verified = vpr(root, ["verify", "sample", "sample-card", "1.0.0"]);
    expect([verified.status, verified.json.ok, verified.json.examples]).toEqual([0, true, [{ id: "navy", ok: true }]]);
    appendFileSync(path.join(kitDir, "kit.cjs"), "\n// changed");
    const changed = vpr(root, ["verify", "sample", "sample-card", "1.0.0"]);
    expect([changed.status, changed.json.problems[0].code]).toEqual([2, "kit-mismatch"]);
  });

  it("refuses a kit that is not there as a runtime error, and a bad path as a usage one", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cli-kit-"));
    roots.push(root);
    expect(vpr(root, ["seal", "sample", "nowhere", "1.0.0"]).status).toBe(2);
    expect(vpr(root, ["seal", "a/b/c", "sample-card", "1.0.0"]).status).toBe(1);
  });
});
