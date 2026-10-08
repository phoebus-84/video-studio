// ---------------------------------------------------------------------------
// `vpr` runs the pipeline the library declares (avg-sxk), and finds the
// built-in pipelines without AVG_BUILTIN_PIPELINES. Spawns the compiled CLI,
// like cli.test.ts: run through `npm test`, whose `pretest` rebuilds dist/.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { reviewChainPipeline } from "../unit/execution/helpers/review-chain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../../dist/src/cli.js");
const EP = "dentro-i-versi/long/il-lampo";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/** A library whose series declares `pipeline`. */
async function library(pipeline: string) {
  const root = await mkdtemp(path.join(tmpdir(), "cli-declared-"));
  roots.push(root);
  const series = path.join(root, "dentro-i-versi", "series", "long");
  await mkdir(path.join(series, "episodes", "il-lampo"), { recursive: true });
  await writeFile(path.join(series, "pipeline.yaml"), `pipeline: ${pipeline}\n`);
  return root;
}

function vpr(root: string, args: string[], builtins?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVG_OPERATOR_KEY_FILE: path.join(tmpdir(), "vpr-cli-no-operator-key"),
  };
  delete env.AVG_BUILTIN_PIPELINES;
  delete env.AVG_LIBRARY_ROOT;
  if (builtins) env.AVG_BUILTIN_PIPELINES = builtins;
  const result = spawnSync("node", [cliPath, ...args, "--library", root, "--json"], {
    encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], env,
  });
  return { status: result.status ?? 1, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

describe("vpr and the declared pipeline", () => {
  it("reports the pipeline the series declares, with no --pipeline", async () => {
    const root = await library("review-chain");
    const status = vpr(root, ["status", EP], await reviewChainPipeline(roots));
    expect(status.status).toBe(0);
    expect(status.json.pipeline).toBe("review-chain");
    expect(status.json.stages.map((s: { stageId: string }) => s.stageId)).toContain("upstream");
  });

  it("lets --pipeline win over the declaration", async () => {
    const root = await library("not-installed");
    const status = vpr(root, ["status", EP, "--pipeline", "review-chain"], await reviewChainPipeline(roots));
    expect(status.status).toBe(0);
    expect(status.json.pipeline).toBe("review-chain");
  });

  it("refuses a declaration it cannot read, and claims nothing", async () => {
    const root = await library("../escape");
    const run = vpr(root, ["run", EP], await reviewChainPipeline(roots));
    expect([run.status, run.json.code]).toEqual([2, "bad-name"]); // EX_RUNTIME
    expect(run.json.error).toContain("dentro-i-versi/series/long/pipeline.yaml");
  });

  it("says a read-only command recorded nothing only where it could have", async () => {
    const root = await library("../escape");
    const status = vpr(root, ["status", EP], await reviewChainPipeline(roots));
    expect([status.status, status.json.code]).toEqual([2, "bad-name"]);
    expect(status.json.error).not.toContain("Nothing was recorded");
  });

  it("verifies pins without the pipeline, so a bad declaration does not stop it", async () => {
    const root = await library("../escape");
    const verified = vpr(root, ["pin", "verify", EP], await reviewChainPipeline(roots));
    expect(verified.status).toBe(0);
    expect(verified.json.pins).toEqual([]);
    const added = vpr(root, ["pin", "add", EP, "poesia", "--source", "channel:il-lampo", "--used-by", "upstream"], await reviewChainPipeline(roots));
    expect([added.status, added.json.code]).toEqual([2, "bad-name"]);
  });

  it("finds the built-in pipelines without AVG_BUILTIN_PIPELINES", async () => {
    const root = await library("series-production");
    const status = vpr(root, ["status", EP]);
    expect(status.status).toBe(0);
    expect(status.json.pipeline).toBe("series-production");
    expect(status.json.stages.map((s: { stageId: string }) => s.stageId)).toContain("spec");
  });
});
