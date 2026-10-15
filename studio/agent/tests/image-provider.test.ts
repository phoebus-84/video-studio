import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { seriesPath, channelPath } from "@studio/contracts/src/layout.mjs";
import {
  parseProvider,
  resolveImageProvider,
  DEFAULT_FAL_MODEL,
  DEFAULT_CODEX_MODEL,
} from "../src/image-provider.js";

/**
 * Which provider a series uses decides which account gets billed — fal.ai per
 * image, or a ChatGPT plan. Getting it wrong is not a rendering bug, it is a
 * charge on the wrong card, so the resolution rules are pinned here.
 */
describe("image provider resolution", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "provider-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writePipeline(dir: string, yaml: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pipeline.yaml"), yaml, "utf-8");
  }

  describe("parseProvider", () => {
    it("defaults to fal when nothing is configured", () => {
      expect(parseProvider(undefined)).toEqual({ kind: "fal", model: DEFAULT_FAL_MODEL });
      expect(parseProvider("  ")).toEqual({ kind: "fal", model: DEFAULT_FAL_MODEL });
    });

    it("treats a bare openai-codex as the plan with a default routing model", () => {
      expect(DEFAULT_CODEX_MODEL).toBe("gpt-6.1-sol");
      expect(parseProvider("openai-codex")).toEqual({ kind: "codex", model: "gpt-6.1-sol" });
      expect(parseProvider("openai-codex/")).toEqual({ kind: "codex", model: "gpt-6.1-sol" });
    });

    it("takes the routing model from the suffix", () => {
      expect(parseProvider("openai-codex/gpt-5.5-mini")).toEqual({
        kind: "codex",
        model: "gpt-5.5-mini",
      });
    });

    it("keeps every existing fal model id working unchanged", () => {
      expect(parseProvider("fal-ai/flux/dev")).toEqual({ kind: "fal", model: "fal-ai/flux/dev" });
      expect(parseProvider("fal-ai/nano-banana")).toEqual({ kind: "fal", model: "fal-ai/nano-banana" });
    });

    it("does not read a bare 'openai' as the subscription", () => {
      // "openai" could mean the plan or metered API credits. Guessing bills
      // someone, so it is not treated as the plan.
      expect(parseProvider("openai").kind).toBe("fal");
    });
  });

  describe("resolveImageProvider", () => {
    it("reads the series pipeline.yaml", () => {
      writePipeline(seriesPath(root, "dyne", "software"), "image:\n  provider: openai-codex\n");

      expect(resolveImageProvider(root, "dyne", "software")).toEqual({
        kind: "codex",
        model: DEFAULT_CODEX_MODEL,
      });
    });

    it("falls back to the channel when the series says nothing", () => {
      writePipeline(channelPath(root, "dyne"), "image:\n  provider: openai-codex/gpt-5.5\n");

      expect(resolveImageProvider(root, "dyne", "software")).toEqual({
        kind: "codex",
        model: "gpt-5.5",
      });
    });

    it("lets a series override its channel", () => {
      writePipeline(channelPath(root, "dyne"), "image:\n  provider: openai-codex\n");
      writePipeline(seriesPath(root, "dyne", "software"), "image:\n  provider: fal-ai/flux/dev\n");

      expect(resolveImageProvider(root, "dyne", "software")).toEqual({
        kind: "fal",
        model: "fal-ai/flux/dev",
      });
    });

    it("accepts the older providers.imageGeneration spelling", () => {
      writePipeline(seriesPath(root, "dyne", "software"), "providers:\n  imageGeneration: fal-ai/nano-banana\n");

      expect(resolveImageProvider(root, "dyne", "software").model).toBe("fal-ai/nano-banana");
    });

    it("falls back to fal rather than guessing when the yaml is malformed", () => {
      writePipeline(seriesPath(root, "dyne", "software"), "image:\n  provider: [unclosed\n");

      expect(resolveImageProvider(root, "dyne", "software")).toEqual({
        kind: "fal",
        model: DEFAULT_FAL_MODEL,
      });
    });

    it("looks under the layout-2 series container, not the channel root", () => {
      // Layout 1 put a series directly under the channel. Reading the old path
      // silently ignored every series-level setting after the migration.
      mkdirSync(join(root, "dyne", "software"), { recursive: true });
      writeFileSync(join(root, "dyne", "software", "pipeline.yaml"), "image:\n  provider: openai-codex\n");

      expect(resolveImageProvider(root, "dyne", "software").kind).toBe("fal");
    });
  });
});
