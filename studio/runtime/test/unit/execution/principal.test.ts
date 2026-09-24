import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCliCredential, defaultOperatorKeyPath } from "../../../src/execution/principal.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe("resolveCliCredential", () => {
  it("is the operator when the key file reads", async () => {
    const d = await mkdtemp(join(tmpdir(), "cred-")); dirs.push(d);
    await writeFile(join(d, "k"), "secret", { mode: 0o600 });
    expect(resolveCliCredential({ AVG_OPERATOR_KEY_FILE: join(d, "k") })).toEqual({ principal: "operator", operatorKey: "secret" });
  });
  it("is an agent with no key file: headless, not an error", async () => {
    const d = await mkdtemp(join(tmpdir(), "cred-")); dirs.push(d);
    expect(resolveCliCredential({ AVG_OPERATOR_KEY_FILE: join(d, "absent") })).toEqual({ principal: "agent", operatorKey: null });
  });
  it("throws on a key other users can read", async () => {
    const d = await mkdtemp(join(tmpdir(), "cred-")); dirs.push(d);
    await writeFile(join(d, "k"), "secret"); await chmod(join(d, "k"), 0o644);
    expect(() => resolveCliCredential({ AVG_OPERATOR_KEY_FILE: join(d, "k") })).toThrow(/0600/);
  });
  it("defaults to the file the gateway writes", () => {
    expect(defaultOperatorKeyPath()).toMatch(/studio[\\/]gateway[\\/]\.operator-key$/);
  });
});
