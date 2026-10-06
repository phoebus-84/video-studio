import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seriesReferencePath } from "@studio/contracts/src/layout.mjs";
import { KEY, propose, REF } from "../helpers/reference-proposal.js";

/**
 * `vpr reference` (avg-jao.6), through the compiled CLI as the operator runs
 * it. Like cli.test.ts it spawns dist/: run it through `npm test -w
 * @studio/runtime`, whose pretest rebuilds.
 */

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/src/cli.js");
let root: string;
let keyFile: string;

function vpr(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("node", [cliPath, ...args, "--library", root, "--json"], {
    encoding: "utf-8",
    env: { ...process.env, AVG_HEADLESS: "", ...env },
  });
  return { status: result.status ?? 1, out: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}
const asOperator = () => ({ AVG_OPERATOR_KEY_FILE: keyFile });
const asAgent = () => ({ AVG_OPERATOR_KEY_FILE: path.join(root, "no-such-key") });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "vpr-reference-cli-"));
  keyFile = path.join(root, ".operator-key");
  writeFileSync(keyFile, KEY, { mode: 0o600 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("vpr reference", () => {
  it("approve promotes a proposal; verify then exits 0 with trusted", () => {
    propose(root);
    const approved = vpr(["reference", "approve", "sample/poetry/morning", "morning-v1", "--note", "the first standard"], asOperator());
    expect(approved.status, approved.stderr).toBe(0);
    expect(existsSync(seriesReferencePath(root, REF.channel, REF.series, "poetry-short", "morning-v1"))).toBe(true);
    const verified = vpr(["reference", "verify", "sample/poetry", "poetry-short", "morning-v1"], asOperator());
    expect(verified.status).toBe(0);
    expect(verified.out.state).toBe("trusted");
  });

  it("approve --dry-run writes nothing", () => {
    propose(root);
    const dry = vpr(["reference", "approve", "sample/poetry/morning", "morning-v1", "--dry-run"], asOperator());
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.out.dryRun).toBe(true);
    expect(existsSync(seriesReferencePath(root, REF.channel, REF.series, "poetry-short", "morning-v1"))).toBe(false);
  });

  it("without the operator key, approve refuses and verify is unverifiable (exit 2)", () => {
    propose(root);
    const approved = vpr(["reference", "approve", "sample/poetry/morning", "morning-v1"], asAgent());
    expect(approved.status).toBe(2);
    expect(approved.out.code).toBe("no-operator-key");
    vpr(["reference", "approve", "sample/poetry/morning", "morning-v1"], asOperator());
    const verified = vpr(["reference", "verify", "sample/poetry", "poetry-short", "morning-v1"], asAgent());
    expect(verified.status).toBe(2);
    expect(verified.out.state).toBe("unverifiable");
  });

  it("a headless caller is never the operator, whatever key file it points at", () => {
    propose(root);
    const approved = vpr(["reference", "approve", "sample/poetry/morning", "morning-v1"], { ...asOperator(), AVG_HEADLESS: "1" });
    expect(approved.status).toBe(2);
    expect(approved.out.code).toBe("no-operator-key");
  });

  it("withdraw needs a reason, then verify says withdrawn and list shows it", () => {
    propose(root);
    vpr(["reference", "approve", "sample/poetry/morning", "morning-v1"], asOperator());
    expect(vpr(["reference", "withdraw", "sample/poetry", "poetry-short", "morning-v1"], asOperator()).status).toBe(1);
    const withdrawn = vpr(["reference", "withdraw", "sample/poetry", "poetry-short", "morning-v1", "--reason", "the recital was re-recorded"], asOperator());
    expect(withdrawn.status, withdrawn.stderr).toBe(0);
    expect(vpr(["reference", "verify", "sample/poetry", "poetry-short", "morning-v1"], asOperator()).out.state).toBe("withdrawn");
    const listed = vpr(["reference", "list", "sample/poetry"], asOperator());
    expect(listed.status).toBe(0);
    expect(listed.out.references).toEqual([{ templateId: "poetry-short", referenceId: "morning-v1", state: "withdrawn" }]);
  });

  it("a malformed command prints the usage and exits 1", () => {
    const bad = vpr(["reference", "approve", "sample/poetry", "morning-v1"], asOperator());
    expect(bad.status).toBe(1);
    expect(bad.out.error).toMatch(/Usage: vpr reference approve/);
  });
});
