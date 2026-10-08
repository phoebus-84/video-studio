import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `vpr theme seal` and `vpr template release` (avg-dcf.6.10), through the
 * compiled CLI as the operator runs them. Like cli.test.ts it spawns dist/:
 * run it through `npm test -w @studio/runtime`, whose pretest rebuilds.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(here, "../../dist/src/cli.js");
const FIXTURES = path.resolve(here, "../../../series/fixtures");
const sha = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let root: string;
const themeDir = (version: string) => path.join(root, "dentro-i-versi", "themes", "dentro-i-versi", version);
const releaseDir = (version: string) => path.join(root, "dentro-i-versi", "series", "long", "templates", "dentro-i-versi-long", version);

function vpr(args: string[]) {
  const result = spawnSync("node", [cliPath, ...args, "--library", root, "--json"], { encoding: "utf-8", env: { ...process.env, AVG_HEADLESS: "" } });
  return { status: result.status ?? 1, out: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "vpr-theme-cli-"));
  cpSync(path.join(FIXTURES, "themes", "dentro-i-versi", "1.0.0"), themeDir("1.0.0"), { recursive: true });
  cpSync(path.join(FIXTURES, "dentro-i-versi-long", "1.0.0", "release"), releaseDir("1.0.0"), { recursive: true });
  cpSync(themeDir("1.0.0"), themeDir("1.1.0"), { recursive: true });
  const file = path.join(themeDir("1.1.0"), "theme.json");
  writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, "utf-8")), version: "1.1.0" }, null, 2)}\n`);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("vpr theme seal, then vpr template release", () => {
  it("seals the theme, prints the pin, and releases the template on it", () => {
    const sealed = vpr(["theme", "seal", "dentro-i-versi/dentro-i-versi/1.1.0"]);
    expect(sealed.status, sealed.stderr).toBe(0);
    expect(sealed.out.hash).toBe(sha(readFileSync(path.join(themeDir("1.1.0"), "theme.json"))));
    expect(sealed.out.message).toContain("--theme dentro-i-versi@1.1.0");

    const released = vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.1.0", "--from", "1.0.0", "--theme", "dentro-i-versi@1.1.0"]);
    expect(released.status, released.stderr).toBe(0);
    expect(released.out.path).toBe("templates/dentro-i-versi-long/1.1.0");
    expect(released.out.theme).toEqual({ id: "dentro-i-versi", version: "1.1.0", hash: sealed.out.hash });
    expect(released.out.hash).toBe(sha(readFileSync(path.join(releaseDir("1.1.0"), "series-template.json"))));
  });

  it("reports a refusal with its code and exit 2, and writes nothing on --dry-run", () => {
    const pinned = vpr(["theme", "seal", "dentro-i-versi/dentro-i-versi/1.0.0"]);
    expect(pinned.status).toBe(2);
    expect(pinned.out.code).toBe("pinned");
    const unsealed = vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.1.0", "--from", "1.0.0", "--theme", "dentro-i-versi@1.1.0"]);
    expect(unsealed.out.code).toBe("theme-unsealed");
    const dry = vpr(["theme", "seal", "dentro-i-versi/dentro-i-versi/1.1.0", "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.out.dryRun).toBe(true);
    expect(JSON.parse(readFileSync(path.join(themeDir("1.1.0"), "theme.json"), "utf-8")).files).toBeUndefined();
    expect(existsSync(releaseDir("1.1.0"))).toBe(false);
  });

  it("--compiler names the new release's compiler; given without a value it is a usage error", () => {
    const released = vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.2.0", "--from", "1.0.0", "--compiler", "1.1.0"]);
    expect(released.status, released.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(releaseDir("1.2.0"), "series-template.json"), "utf-8")).compiler.version).toBe("1.1.0");
    expect(vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.3.0", "--from", "1.0.0", "--compiler"]).status).toBe(1);
  });

  it("a dry run reports what the real command would refuse", () => {
    const pinned = vpr(["theme", "seal", "dentro-i-versi/dentro-i-versi/1.0.0", "--dry-run"]);
    expect(pinned.status).toBe(2);
    expect(pinned.out.code).toBe("pinned");
    const exists = vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.0.0", "--from", "1.0.0", "--dry-run"]);
    expect(exists.out.code).toBe("bad-version");
  });

  it("refuses a malformed command with its usage", () => {
    expect(vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.1.0", "--from", "1.0.0", "--theme"]).status).toBe(1);
    expect(vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.1.0", "--from", "--theme", "dentro-i-versi@1.1.0"]).status).toBe(1);
    expect(vpr(["theme", "seal", "dentro-i-versi/../1.1.0"]).status).toBe(1);
    expect(vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.1.0", "--from", "1.0.0", "--theme", "../x@1.1.0"]).status).toBe(1);
    expect(vpr(["theme", "seal", "dentro-i-versi/1.1.0"]).status).toBe(1);
    expect(vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.1.0"]).status).toBe(1);
    expect(vpr(["template", "release", "dentro-i-versi/long", "dentro-i-versi-long", "1.1.0", "--from", "1.0.0", "--theme", "dentro-i-versi"]).status).toBe(1);
  });
});
