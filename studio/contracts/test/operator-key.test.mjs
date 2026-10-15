import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readOperatorKey, OPERATOR_KEY_ENV } from "../src/operator-key.mjs";

describe("readOperatorKey", () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "opkey-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("names the environment variable callers use to point at the file", () => {
    assert.equal(OPERATOR_KEY_ENV, "AVG_OPERATOR_KEY_FILE");
  });
  it("returns null when there is no key file: that is a headless caller, not an error", () => {
    assert.equal(readOperatorKey(path.join(dir, "missing")), null);
  });
  it("reads and trims a 0600 key", async () => {
    const file = path.join(dir, ".operator-key");
    await writeFile(file, "secret\n", { mode: 0o600 });
    assert.equal(readOperatorKey(file), "secret");
  });
  it("refuses a key other users can read", { skip: process.platform === "win32" }, async () => {
    const file = path.join(dir, ".operator-key");
    await writeFile(file, "secret");
    await chmod(file, 0o644);
    assert.throws(() => readOperatorKey(file), /0600|permissions/);
  });
  it("refuses an empty key rather than signing with nothing", async () => {
    const file = path.join(dir, ".operator-key");
    await writeFile(file, "  \n", { mode: 0o600 });
    assert.throws(() => readOperatorKey(file), /empty/);
  });
});
