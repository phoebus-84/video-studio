// ---------------------------------------------------------------------------
// `vpr pin` end to end (avg-7zp.5): add, verify, renew on a temporary library.
// Spawns the compiled CLI, like cli.test.ts: run through `npm test`, whose
// `pretest` rebuilds dist/ first.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { reviewChainPipeline } from "../unit/execution/helpers/review-chain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../../dist/src/cli.js");
const EP = "dentro-i-versi/long/il-lampo";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function library() {
  const root = await mkdtemp(path.join(tmpdir(), "cli-pin-"));
  roots.push(root);
  const episode = path.join(root, "dentro-i-versi", "series", "long", "episodes", "il-lampo");
  await mkdir(path.join(episode, "artifacts"), { recursive: true });
  const source = path.join(root, "dentro-i-versi", "sources", "il-lampo");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "takes.json"), "{}");
  return { root, episode, source, pipelines: await reviewChainPipeline(roots) };
}

function vpr(lib: { root: string; pipelines: string }, args: string[]) {
  const result = spawnSync("node", [cliPath, ...args, "--library", lib.root, "--pipeline", "review-chain", "--json"], {
    encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
    // Headless, as Pi runs it: the CLI acts as the agent, so a renewal is journaled as "pi".
    env: { ...process.env, AVG_BUILTIN_PIPELINES: lib.pipelines, AVG_HEADLESS: "1" },
  });
  return { status: result.status ?? 1, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

describe("vpr pin", () => {
  it("adds a pin, reports a changed source, and renews it", async () => {
    const lib = await library();

    const added = vpr(lib, ["pin", "add", EP, "poesia", "--source", "channel:il-lampo", "--used-by", "upstream"]);
    expect(added.status).toBe(0);
    expect(Object.keys(added.json.pin.files)).toEqual(["takes.json"]);

    await writeFile(path.join(lib.source, "takes.json"), '{"takes":[]}');
    const verified = vpr(lib, ["pin", "verify", EP]);
    expect(verified.status).toBe(0);
    expect(verified.json.pins).toEqual([
      { id: "poesia", source: { kind: "channel-source", name: "il-lampo" }, changed: [{ path: "takes.json", change: "modified" }] },
    ]);

    const renewed = vpr(lib, ["pin", "renew", EP, "poesia"]);
    expect(renewed.status).toBe(0);
    expect(renewed.json.changed).toEqual([{ path: "takes.json", change: "modified" }]);
    const events = parseJournal(await readFile(path.join(lib.episode, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
    expect(events.at(-1)!.type).toBe("staleness-marked");
    expect(events.at(-1)!.actor).toBe("pi");
    expect((events.at(-1)!.data as { trigger?: string }).trigger).toBe("pin:poesia");

    expect(vpr(lib, ["pin", "verify", EP]).json.pins[0].changed).toEqual([]);
  });

  it("refuses an unknown stage as a usage error and a missing source as a runtime one", async () => {
    const lib = await library();
    const stage = vpr(lib, ["pin", "add", EP, "poesia", "--source", "channel:il-lampo", "--used-by", "compile"]);
    expect([stage.status, stage.json.code]).toEqual([1, "unknown-stage"]); // EX_USAGE
    const source = vpr(lib, ["pin", "add", EP, "poesia", "--source", "channel:nope", "--used-by", "upstream"]);
    expect([source.status, source.json.code]).toEqual([2, "unknown-source"]); // EX_RUNTIME
    const malformed = vpr(lib, ["pin", "add", EP, "poesia", "--source", "nope", "--used-by", "upstream"]);
    expect(malformed.status).toBe(1);
  });
});
