import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../../dist/src/cli.js");

describe("CLI integration", () => {
  function vpr(args: string[]): { stdout: string; stderr: string; status: number } {
    const result = spawnSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      status: result.status ?? 1,
    };
  }

  it("prints help with --help", () => {
    const { stderr, status } = vpr(["--help"]);
    // Should succeed
    expect(status).toBe(0);
    expect(stderr).toContain("Usage: vpr");
  });

  it("prints version with --version", () => {
    const { stdout, status } = vpr(["--version"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("0.1.0");
  });

  it("prints version with -v", () => {
    const { stdout, status } = vpr(["-v"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("0.1.0");
  });

  it("warns on unknown command", () => {
    const { stderr, status } = vpr(["unknown-cmd"]);
    // Not a fatal error yet – just a warning.
    expect(status).toBe(0);
    expect(stderr).toContain("Unknown command");
  });

  it("prints help when invoked with no arguments", () => {
    const { stderr, status } = vpr([]);
    expect(status).toBe(0);
    expect(stderr).toContain("Usage: vpr");
  });
});
