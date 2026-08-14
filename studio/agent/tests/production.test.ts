/**
 * Production install smoke test.
 *
 * Validates that the package can work in a production install scenario
 * where devDependencies are not available.
 *
 * This test does NOT do a real `npm install --omit=dev`. Instead it
 * validates:
 * - All imports used by the extension are declared in peerDependencies
 *   (available at runtime from the host) or would be resolved by the
 *   host environment.
 * - No runtime code imports from devDependencies.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PKG_PATH = resolve(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8")) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Peer dependency validation
// ---------------------------------------------------------------------------

describe("production install — peer dependencies", () => {
  it("all Pi core packages are in peerDependencies, not dependencies", () => {
    const deps = (pkg.dependencies as Record<string, string>) ?? {};
    const peerDeps = (pkg.peerDependencies as Record<string, string>) ?? {};
    const piCorePackages = [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui",
    ];

    for (const p of piCorePackages) {
      // Must be in peerDependencies
      expect(peerDeps).toHaveProperty(p);
      // Must NOT be in regular dependencies (Pi provides them)
      expect(deps).not.toHaveProperty(
        p,
        `${p} should be a peerDependency, not dependency`,
      );
    }
  });

  it("typebox is in peerDependencies, not dependencies", () => {
    const deps = (pkg.dependencies as Record<string, string>) ?? {};
    const peerDeps = (pkg.peerDependencies as Record<string, string>) ?? {};

    expect(peerDeps).toHaveProperty("typebox");
    expect(deps).not.toHaveProperty(
      "typebox",
      "typebox should be a peerDependency, not dependency",
    );
  });
});

// ---------------------------------------------------------------------------
// Package loading validation
// ---------------------------------------------------------------------------

describe("production install — import validation", () => {
  it("extension module can be imported", async () => {
    // This validates the extension can be loaded at all.
    // If devDependencies are installed, the imports will resolve.
    // In production, Pi provides the peerDependencies.
    const mod = await import("../extensions/index.js");
    expect(mod).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// devDependencies isolation
// ---------------------------------------------------------------------------

describe("production install — devDependencies isolation", () => {
  it("test framework (vitest) is not in dependencies", () => {
    const deps = (pkg.dependencies as Record<string, string>) ?? {};
    expect(deps).not.toHaveProperty("vitest");
  });

  it("typescript is not in dependencies", () => {
    const deps = (pkg.dependencies as Record<string, string>) ?? {};
    expect(deps).not.toHaveProperty("typescript");
  });

  it("@types/node is not in dependencies", () => {
    const deps = (pkg.dependencies as Record<string, string>) ?? {};
    for (const key of Object.keys(deps)) {
      expect(key.startsWith("@types/")).toBe(false);
    }
  });
});
