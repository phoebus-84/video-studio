/**
 * Tests for package.json manifest structure.
 *
 * Validates the package manifest conforms to Pi package conventions:
 * - pi.extensions and pi.skills fields are present
 * - peerDependencies list required Pi core packages
 * - No runtime dependencies overlap with devDependencies wrongly
 * - keywords include pi-package
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PKG_PATH = resolve(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8")) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Pi manifest
// ---------------------------------------------------------------------------

describe("package.json pi manifest", () => {
  it('has the "pi" key', () => {
    expect(pkg).toHaveProperty("pi");
  });

  it("declares pi.extensions", () => {
    const pi = pkg.pi as Record<string, unknown>;
    expect(pi).toHaveProperty("extensions");
    expect(Array.isArray(pi.extensions)).toBe(true);
    expect((pi.extensions as string[]).length).toBeGreaterThan(0);
  });

  it("declares pi.skills", () => {
    const pi = pkg.pi as Record<string, unknown>;
    expect(pi).toHaveProperty("skills");
    expect(Array.isArray(pi.skills)).toBe(true);
    expect((pi.skills as string[]).length).toBeGreaterThan(0);
  });

  it('includes "pi-package" keyword', () => {
    const keywords = pkg.keywords as string[];
    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords).toContain("pi-package");
  });
});

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

describe("package.json dependencies", () => {
  it("has runtime dependencies (if any) distinct from devDependencies", () => {
    const deps = (pkg.dependencies as Record<string, string>) ?? {};
    const devDeps = (pkg.devDependencies as Record<string, string>) ?? {};

    for (const dep of Object.keys(deps)) {
      expect(devDeps).not.toHaveProperty(
        dep,
        `"${dep}" is in both dependencies and devDependencies`,
      );
    }
  });

  it("declares Pi core packages as peerDependencies", () => {
    const peerDeps = (pkg.peerDependencies as Record<string, string>) ?? {};
    const requiredPeers = [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui",
    ];

    for (const p of requiredPeers) {
      expect(
        peerDeps,
        `Missing peerDependency: ${p}`,
      ).toHaveProperty(p);
    }
  });

  it("declares typebox as peerDependency", () => {
    const peerDeps = (pkg.peerDependencies as Record<string, string>) ?? {};
    expect(peerDeps).toHaveProperty("typebox");
  });
});

// ---------------------------------------------------------------------------
// File references
// ---------------------------------------------------------------------------

describe("package.json files field", () => {
  it("includes security notice in files", () => {
    const files = pkg.files as string[];
    expect(files).toContain("SECURITY.md");
  });

  it("includes skills directory in files", () => {
    const files = pkg.files as string[];
    const hasSkills = files.some(
      (f) => f.startsWith("skills") && f !== "skills",
    );
    expect(hasSkills || files.includes("skills/")).toBe(true);
  });

  it("every file entry exists on disk", () => {
    const files = pkg.files as string[];
    for (const f of files) {
      // Trailing slash means directory
      if (f.endsWith("/")) {
        expect(
          existsSync(resolve(__dirname, "..", f)),
          `Directory listed in "files" does not exist: ${f}`,
        ).toBe(true);
      } else {
        expect(
          existsSync(resolve(__dirname, "..", f)),
          `File listed in "files" does not exist: ${f}`,
        ).toBe(true);
      }
    }
  });
});
