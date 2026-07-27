/**
 * Tests for SECURITY.md — validates the security notice exists and
 * covers required topics about full-system-access implications.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SECURITY_PATH = resolve(__dirname, "..", "SECURITY.md");

function getSecurityContent(): string {
  if (!existsSync(SECURITY_PATH)) {
    throw new Error(`SECURITY.md not found at ${SECURITY_PATH}`);
  }
  return readFileSync(SECURITY_PATH, "utf-8");
}

describe("SECURITY.md", () => {
  it("exists in the package root", () => {
    expect(existsSync(SECURITY_PATH)).toBe(true);
  });

  it("mentions full system access", () => {
    const content = getSecurityContent();
    expect(content.toLowerCase()).toMatch(/full.system.access|full system access/);
  });

  it("mentions extensions execute arbitrary code", () => {
    const content = getSecurityContent();
    expect(content.toLowerCase()).toMatch(/arbitrary/);
    expect(content.toLowerCase()).toMatch(/extension/);
  });

  it("mentions skills can instruct the model", () => {
    const content = getSecurityContent();
    expect(content.toLowerCase()).toMatch(/skill/);
    expect(content.toLowerCase()).toMatch(/instruct|guide|direct/);
  });

  it("contains a section about reviewing source code before install", () => {
    const content = getSecurityContent();
    expect(content.toLowerCase()).toMatch(/review.*source|inspect.*code|audit/);
  });

  it("mentions project-local install as a mitigation", () => {
    const content = getSecurityContent();
    expect(content.toLowerCase()).toMatch(/project.local|project-local|-l/);
  });

  it("contains reporting instructions", () => {
    const content = getSecurityContent();
    expect(content.toLowerCase()).toMatch(/report|issue tracker|contact/);
  });

  it("is non-empty and substantive", () => {
    const content = getSecurityContent();
    expect(content.length).toBeGreaterThan(500);
  });
});
