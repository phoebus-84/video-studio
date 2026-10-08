import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { episodePath } from "@studio/contracts/src/layout.mjs";

/**
 * `vpr sheet` (avg-3th.2), through the compiled CLI as the operator runs it.
 * Like cli.test.ts it spawns dist/: run it through `npm test -w
 * @studio/runtime`, whose pretest rebuilds.
 */

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/src/cli.js");
const KEY = "test-operator-key";
const sha = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let root: string;
let keyFile: string;
const sheetDir = () => path.join(episodePath(root, "sample", "poetry", "morning"), "artifacts", "layout-sheet");

function vpr(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("node", [cliPath, ...args, "--library", root, "--json"], { encoding: "utf-8", env: { ...process.env, AVG_HEADLESS: "", ...env } });
  return { status: result.status ?? 1, out: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}
const asOperator = () => ({ AVG_OPERATOR_KEY_FILE: keyFile });
const asAgent = () => ({ AVG_OPERATOR_KEY_FILE: path.join(root, "no-such-key") });

/** A sheet as makeLayoutSheet leaves it: the grid, one still, and sheet.json naming them by hash. */
function laySheet(): void {
  mkdirSync(path.join(sheetDir(), "frames"), { recursive: true });
  writeFileSync(path.join(sheetDir(), "sheet.jpg"), "grid");
  writeFileSync(path.join(sheetDir(), "frames", "000.jpg"), "still 0");
  writeFileSync(path.join(sheetDir(), "sheet.json"), JSON.stringify({
    inputsHash: sha("inputs"),
    sheet: { path: "sheet.jpg", hash: sha("grid") },
    frames: [{ index: 0, frame: 0, seconds: 0, label: "first", path: "frames/000.jpg", hash: sha("still 0") }],
  }));
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "vpr-sheet-cli-"));
  keyFile = path.join(root, ".operator-key");
  writeFileSync(keyFile, KEY, { mode: 0o600 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("vpr sheet", () => {
  it("approve signs the sheet on disk; status then exits 0, and says what it did not check", () => {
    laySheet();
    const approved = vpr(["sheet", "approve", "sample/poetry/morning", "--note", "every tile read"], asOperator());
    expect(approved.status, approved.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(sheetDir(), "review.json"), "utf-8")).note).toBe("every tile read");
    const status = vpr(["sheet", "status", "sample/poetry/morning"], asOperator());
    expect(status.status).toBe(0);
    expect(status.out.state).toBe("approved");
    expect(status.out.message).toMatch(/the render checks that the sheet still pictures the timeline/);
  });

  it("takes --note before the episode too", () => {
    laySheet();
    const approved = vpr(["sheet", "approve", "--note", "fine", "sample/poetry/morning"], asOperator());
    expect(approved.status, approved.stderr).toBe(0);
  });

  it("never takes another flag as the note", () => {
    laySheet();
    const rejected = vpr(["sheet", "reject", "sample/poetry/morning", "--note", "--dry-run"], asOperator());
    expect(rejected.status).toBe(1);
    expect(existsSync(path.join(sheetDir(), "review.json"))).toBe(false);
  });

  it("refuses a sheet whose still is not the one rendered, as the render would", () => {
    laySheet();
    writeFileSync(path.join(sheetDir(), "frames", "000.jpg"), "another still");
    const approved = vpr(["sheet", "approve", "sample/poetry/morning"], asOperator());
    expect(approved.status).toBe(2);
    expect(approved.out.code).toBe("sheet-changed");
  });

  it("without the operator key, approve refuses and status exits 2 while unreviewed", () => {
    laySheet();
    const approved = vpr(["sheet", "approve", "sample/poetry/morning"], asAgent());
    expect(approved.status).toBe(2);
    expect(approved.out.code).toBe("no-operator-key");
    const status = vpr(["sheet", "status", "sample/poetry/morning"], asAgent());
    expect(status.status).toBe(2);
    expect(status.out.state).toBe("unreviewed");
  });
});
