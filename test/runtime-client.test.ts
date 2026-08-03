import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeClient } from "../src/runtime/client.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RuntimeClient", () => {
  it("passes an explicitly resolved pipeline to snapshot resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "gateway-runtime-client-"));
    roots.push(root);
    const cliPath = join(root, "fake-vpr.mjs");
    await writeFile(cliPath, "process.stdout.write(JSON.stringify({args: process.argv.slice(2)}));\n", "utf-8");
    const client = new RuntimeClient({ cliPath, libraryRoot: root });

    const result = await client.resolve({ channel: "wordless-comedy", series: "give-me-time", episode: "the-run-up" }, "wordless-rigged-short");

    expect(result.ok).toBe(true);
    expect(result.data?.args).toEqual([
      "resolve",
      "wordless-comedy/give-me-time/the-run-up",
      "--pipeline",
      "wordless-rigged-short",
      "--json",
    ]);
  });
});
