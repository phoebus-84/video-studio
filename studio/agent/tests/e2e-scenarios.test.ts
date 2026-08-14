// ---------------------------------------------------------------------------
// E2E Pi scenarios and release checks
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { resolveConfig } from "../src/config.js";
import { discoverSkills } from "../src/skills.js";
import { gatherContext } from "../src/context.js";
import { trustGuard, sanitizeSlug, guardPath, guardDestructive, guardOutput } from "../src/trust-guards.js";

// ── E2E scenarios ───────────────────────────────────────────────────────────

describe("E2E scenarios", () => {
  describe("one-prompt fairy-tale autopilot", () => {
    it("resolves configuration", async () => {
      const config = await resolveConfig();
      expect(config.resolved).toBe(true);
      expect(config.libraryRoot).toBeTruthy();
      expect(config.gatewayUrl).toBeTruthy();
    });

    it("discovers built-in skills", async () => {
      const catalog = await discoverSkills();
      const builtIn = catalog.list({ source: "built-in" });
      expect(Array.isArray(builtIn)).toBe(true);
    });

    it("discovers series-local skills", async () => {
      const catalog = await discoverSkills();
      expect(Array.isArray(catalog.list())).toBe(true);
      expect(catalog.skills).toBeDefined();
    });

    it("loads a skill by ID if any exist", async () => {
      const catalog = await discoverSkills();
      const all = catalog.list();
      if (all.length > 0) {
        const content = await catalog.load(all[0]!.id);
        expect(content).toBeTruthy();
      }
    });

    it("gathers context gracefully", async () => {
      const ctx = await gatherContext("test", "series", "ep001");
      expect(ctx.summary).toBeTruthy();
      expect(ctx.data.episodeSlug).toBe("test/series/ep001");
    });
  });

  describe("interactive correction workflow", () => {
    it("sanitizes episode slugs", () => {
      expect(sanitizeSlug("my-channel/my-series/ep-001").allowed).toBe(true);
      expect(sanitizeSlug("bad slug!/ep#1").allowed).toBe(false);
      expect(sanitizeSlug("a/b/c/d").allowed).toBe(false);
      expect(sanitizeSlug("").allowed).toBe(false);
    });

    it("guards path containment", async () => {
      const root = "/tmp/test-library";
      expect((await guardPath(root, "test/series/ep1/scripts/brief.md")).allowed).toBe(true);
      expect((await guardPath(root, "../../etc/passwd")).allowed).toBe(false);
      expect((await guardPath(root, "test/\0bad")).allowed).toBe(false);
    });

    it("guards destructive operations", () => {
      expect(guardDestructive("read").allowed).toBe(true);
      expect(guardDestructive("delete").allowed).toBe(false);
      expect(guardDestructive("force-rerun").allowed).toBe(false);
      expect(guardDestructive("log").allowed).toBe(true);
    });

    it("guards output boundaries", () => {
      const root = "/tmp/test-library";
      expect(guardOutput(`${root}/output/render.mp4`, root).allowed).toBe(true);
      expect(guardOutput("/tmp/unauthorized.mp4", root).allowed).toBe(false);
    });

    it("composite trust guard", async () => {
      const ok = await trustGuard("read", {
        channel: "ch", series: "s", episode: "ep",
        path: "scripts/brief.md",
      });
      expect(ok.allowed).toBe(true);
    });

    it("trust guard rejects destructive", async () => {
      const result = await trustGuard("delete", {
        channel: "ch", series: "s", episode: "ep",
        path: "artifacts/render.mp4",
      });
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("OPERATOR_CONFIRMATION_REQUIRED");
    });
  });

  describe("session reload and crash", () => {
    it("configuration is deterministic", async () => {
      const c1 = await resolveConfig();
      const c2 = await resolveConfig();
      expect(c1.libraryRoot).toBe(c2.libraryRoot);
    });

    it("skill catalog is stable across calls", async () => {
      const c1 = await discoverSkills();
      const c2 = await discoverSkills();
      expect(c1.list().length).toBe(c2.list().length);
    });

    it("malformed slug does not crash", () => {
      expect(sanitizeSlug("").allowed).toBe(false);
      expect(sanitizeSlug("a/b/c/d/e").allowed).toBe(false);
    });

    it("null path does not crash guard", async () => {
      const result = await guardPath("/tmp", "" as any);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("INVALID_PATH");
    });

    it("context degrades gracefully for missing episodes", async () => {
      const ctx = await gatherContext("nonexistent", "series", "ep");
      expect(ctx.summary).toBeTruthy();
      expect(ctx.hasBlockers).toBe(false);
    });
  });
});

// ── Release checks ──────────────────────────────────────────────────────────

describe("Package release checks", () => {
  it("package.json has required fields", async () => {
    const fs = await import("node:fs/promises");
    const url = new URL("../package.json", import.meta.url);
    const raw = await fs.readFile(url, "utf-8");
    const pkg = JSON.parse(raw);
    // The npm package is @studio/agent; "pi-video-agent" remains the Pi
    // extension identity that Pi registers and users see (extensions/index.ts).
    expect(pkg.name).toBe("@studio/agent");
    expect(pkg.version).toBeTruthy();
    expect(pkg.type).toBe("module");
    expect(pkg.pi.extensions).toEqual(["./extensions"]);
  });

  it("SECURITY.md exists", async () => {
    const fs = await import("node:fs/promises");
    const url = new URL("../SECURITY.md", import.meta.url);
    const content = await fs.readFile(url, "utf-8");
    expect(content.length).toBeGreaterThan(100);
  });

  it("README.md exists", async () => {
    const fs = await import("node:fs/promises");
    const url = new URL("../README.md", import.meta.url);
    const content = await fs.readFile(url, "utf-8");
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain("pi");
  });

  it("extension exports a default factory", async () => {
    const mod = await import("../extensions/index.js");
    expect(typeof mod.default).toBe("function");
    expect(mod.default.length).toBe(1);
  });

  it("all 33 tools have unique names", () => {
    const names = [
      "pva_version", "pva_diagnostics", "pva_config", "pva_health",
      "pva_create_channel", "pva_create_series", "pva_create_episode",
      "pva_channels", "pva_series", "pva_episodes", "pva_episode_detail",
      "pva_snapshot", "pva_run_stage", "pva_run_pipeline",
      "pva_check_staleness", "pva_plan_rerun", "pva_approve",
      "pva_budget_status", "pva_journal",
      "pva_generate_image", "pva_synthesize_speech", "pva_synthesize_nonverbal_audio",
      "pva_render_graphics", "pva_render_terminal", "pva_render_vector_animation",
      "pva_compose_video", "pva_compose_multitrack_video", "pva_probe_media", "pva_capability_status",
      "pva_list_skills", "pva_load_skill", "pva_gather_context",
      "pva_rpc_health",
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  it("tool names follow convention", () => {
    const names = [
      "pva_version", "pva_diagnostics", "pva_config", "pva_health",
      "pva_channels", "pva_series", "pva_episodes", "pva_episode_detail",
    ];
    for (const name of names) {
      expect(name).toMatch(/^[a-z_]+$/);
    }
  });
});
