// ---------------------------------------------------------------------------
// .uiignore rules: defaults, then a layer per folder, the deeper one winning
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_UIIGNORE, UiIgnore } from "../src/workspace/uiignore.js";

let ch: string;

beforeEach(async () => {
  ch = mkdtempSync(join(tmpdir(), "uiignore-"));
  await fs.mkdir(join(ch, "series", "s1", "episodes", "e1"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(ch, { recursive: true, force: true });
});

describe("UiIgnore", () => {
  it("leaves out the defaults anywhere in the channel", async () => {
    const rules = await UiIgnore.forDirectory(ch, ch);
    for (const file of ["bun.lock", "package-lock.json", "pnpm-lock.yaml", "media.lock.jsonl", "series/s1/kits.lock.json", "x.tmp", "t.bak.json"]) {
      expect(rules.isIgnored(join(ch, file), false), file).toBe(true);
    }
    for (const dir of ["node_modules", ".git", ".cache", "series/s1/node_modules"]) {
      expect(rules.isIgnored(join(ch, dir), true), dir).toBe(true);
    }
    for (const file of ["channel.md", "pipeline.yaml", "series/s1/spec.json", ".uiignore", "locksmith.md"]) {
      expect(rules.isIgnored(join(ch, file), false), file).toBe(false);
    }
  });

  it("matches a folder pattern only against folders", async () => {
    const rules = await UiIgnore.forDirectory(ch, ch);
    expect(rules.isIgnored(join(ch, "node_modules"), false)).toBe(false);
    expect(rules.isIgnored(join(ch, "node_modules"), true)).toBe(true);
  });

  it("reads each .uiignore from the channel down to the folder listed, the deeper one winning", async () => {
    await fs.writeFile(join(ch, ".uiignore"), "# the channel's\n*.psd\n!media.lock.jsonl\n");
    await fs.writeFile(join(ch, "series", "s1", ".uiignore"), "!*.psd\n/notes/\n");
    const atSeries = await UiIgnore.forDirectory(ch, join(ch, "series", "s1"));
    expect(atSeries.isIgnored(join(ch, "series", "s1", "cover.psd"), false)).toBe(false);
    expect(atSeries.isIgnored(join(ch, "series", "s1", "notes"), true)).toBe(true);
    // Anchored to the series: a notes/ deeper down is not the series' notes/.
    expect(atSeries.isIgnored(join(ch, "series", "s1", "episodes", "notes"), true)).toBe(false);

    const atChannel = await UiIgnore.forDirectory(ch, ch);
    expect(atChannel.isIgnored(join(ch, "cover.psd"), false)).toBe(true);
    expect(atChannel.isIgnored(join(ch, "media.lock.jsonl"), false)).toBe(false);
  });

  it("leaves out everything below a folder that is itself left out", async () => {
    await fs.mkdir(join(ch, "node_modules", "pkg"), { recursive: true });
    const inside = await UiIgnore.forDirectory(ch, join(ch, "node_modules", "pkg"));
    expect(inside.inherited).toBe(true);
    expect(inside.isIgnored(join(ch, "node_modules", "pkg", "README.md"), false)).toBe(true);
  });

  it("has defaults that are valid patterns with comments", () => {
    expect(DEFAULT_UIIGNORE.some((l) => l.startsWith("#"))).toBe(true);
    expect(DEFAULT_UIIGNORE).toContain("*.lock");
  });
});
