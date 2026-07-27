/**
 * Tests for documentation files (CONTRIBUTING.md, README.md).
 *
 * Validates that contributor and public contract documentation
 * exists and covers required topics.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

function readDoc(name: string): string {
  const path = resolve(ROOT, name);
  if (!existsSync(path)) {
    throw new Error(`${name} not found at ${path}`);
  }
  return readFileSync(path, "utf-8");
}

// ---------------------------------------------------------------------------
// CONTRIBUTING.md
// ---------------------------------------------------------------------------

describe("CONTRIBUTING.md", () => {
  it("exists", () => {
    expect(existsSync(resolve(ROOT, "CONTRIBUTING.md"))).toBe(true);
  });

  it("documents development setup", () => {
    const content = readDoc("CONTRIBUTING.md");
    expect(content).toMatch(/Development Setup|Getting Started|Prerequisites/i);
  });

  it("documents how to run tests", () => {
    const content = readDoc("CONTRIBUTING.md");
    expect(content).toMatch(/npm test|npm run test|vitest/);
  });

  it("documents local development install using pi -e or pi install", () => {
    const content = readDoc("CONTRIBUTING.md");
    expect(content).toMatch(/pi -e|pi install/);
  });

  it("documents package structure", () => {
    const content = readDoc("CONTRIBUTING.md");
    expect(content).toMatch(/package structure|project structure|directory structure/i);
  });

  it("documents how to add extensions and skills", () => {
    const content = readDoc("CONTRIBUTING.md");
    expect(content).toMatch(/adding extensions/i);
    expect(content).toMatch(/adding skills/i);
  });

  it("documents code style and testing guidelines", () => {
    const content = readDoc("CONTRIBUTING.md");
    expect(content).toMatch(/code style|testing guideline/i);
  });
});

// ---------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------

describe("README.md", () => {
  it("exists", () => {
    expect(existsSync(resolve(ROOT, "README.md"))).toBe(true);
  });

  it("identifies the package as a Pi package", () => {
    const content = readDoc("README.md");
    expect(content).toMatch(/Pi package|pi-video-agent/);
  });

  it("describes the package boundary (what it owns)", () => {
    const content = readDoc("README.md");
    expect(content).toMatch(/Owns|owns|boundary|scope/i);
  });

  it("references the plan or Beads issues for details", () => {
    const content = readDoc("README.md");
    expect(content).toMatch(/Plan|bd list|PLAN.md/);
  });
});
