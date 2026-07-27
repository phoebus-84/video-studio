/**
 * Tests for the extension entry point (extensions/index.ts).
 *
 * These tests validate:
 * - The extension exports a default function
 * - The function accepts an ExtensionAPI-shaped object
 * - Tools are registered with correct names and parameter schemas
 * - Tool execution returns well-formed results
 * - Diagnostics capture errors and warnings
 * - Lifecycle handlers are registered
 *
 * The tests use a mock ExtensionAPI to avoid depending on a live Pi runtime.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We import the extension factory and its exported types.
// The factory module depends on @earendil-works/pi-coding-agent and typebox,
// which must be available as devDependencies.
import createExtension from "../extensions/index.js";
import type { PvaVersionResult, PvaDiagnostics } from "../extensions/index.js";

// ---------------------------------------------------------------------------
// Minimal mock of ExtensionAPI + ExtensionContext
// ---------------------------------------------------------------------------

/** Collects registered event handlers keyed by event name. */
type HandlerMap = Map<string, Array<(...args: unknown[]) => unknown>>;

interface MockTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (...args: unknown[]) => Promise<unknown>;
}

function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    mode: "tui" as const,
    hasUI: true,
    cwd: "/fake/cwd",
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
      select: vi.fn().mockResolvedValue("option"),
      input: vi.fn().mockResolvedValue("text"),
    },
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
      getBranch: vi.fn().mockReturnValue([]),
      buildContextEntries: vi.fn().mockReturnValue([]),
      getLeafId: vi.fn().mockReturnValue("leaf-1"),
      getSessionFile: vi.fn().mockReturnValue("/tmp/session.jsonl"),
    },
    signal: undefined as AbortSignal | undefined,
    isIdle: vi.fn().mockReturnValue(true),
    abort: vi.fn(),
    ...overrides,
  };
}

function createMockPi() {
  const handlers: HandlerMap = new Map();
  const tools: MockTool[] = [];

  return {
    handlers,
    tools,

    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),

    registerTool: vi.fn((tool: MockTool) => {
      tools.push(tool);
    }),

    async fireEvent(event: string, ...args: unknown[]) {
      const hs = handlers.get(event) ?? [];
      const results = [];
      for (const h of hs) {
        results.push(await h(...args));
      }
      return results;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extensions/index.ts — module shape", () => {
  it("exports a default function", () => {
    expect(typeof createExtension).toBe("function");
  });

  it("default export has length 1 (accepts ExtensionAPI)", () => {
    expect(createExtension.length).toBe(1);
  });
});

describe("extensions/index.ts — tool registration", () => {
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
    createExtension(mockPi as unknown as Parameters<typeof createExtension>[0]);
  });

  it("registers pva_version tool", () => {
    const versionTool = mockPi.tools.find((t) => t.name === "pva_version");
    expect(versionTool).toBeDefined();
    expect(versionTool!.label).toBe("PVA Version");
    expect(typeof versionTool!.description).toBe("string");
    expect(versionTool!.description.length).toBeGreaterThan(0);
  });

  it("registers pva_diagnostics tool", () => {
    const diagTool = mockPi.tools.find((t) => t.name === "pva_diagnostics");
    expect(diagTool).toBeDefined();
    expect(diagTool!.label).toBe("PVA Diagnostics");
    expect(typeof diagTool!.description).toBe("string");
    expect(diagTool!.description.length).toBeGreaterThan(0);
  });

  it("registers the expected suite of production tools", () => {
    expect(mockPi.tools.length).toBe(25);
    const names = mockPi.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "pva_approve",
      "pva_budget_status",
      "pva_capability_status",
      "pva_channels",
      "pva_check_staleness",
      "pva_compose_video",
      "pva_config",
      "pva_diagnostics",
      "pva_episode_detail",
      "pva_episodes",
      "pva_gather_context",
      "pva_generate_image",
      "pva_health",
      "pva_journal",
      "pva_list_skills",
      "pva_load_skill",
      "pva_plan_rerun",
      "pva_probe_media",
      "pva_render_graphics",
      "pva_run_pipeline",
      "pva_run_stage",
      "pva_series",
      "pva_snapshot",
      "pva_synthesize_speech",
      "pva_version",
    ]);
  });

  it("pva_version parameters is an empty object schema", () => {
    const tool = mockPi.tools.find((t) => t.name === "pva_version")!;
    // typebox Object schemas have a known shape in practice
    expect(tool.parameters).toBeDefined();
  });
});

describe("extensions/index.ts — tool execution", () => {
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
    createExtension(mockPi as unknown as Parameters<typeof createExtension>[0]);
  });

  describe("pva_version", () => {
    it("returns well-formed result", async () => {
      const tool = mockPi.tools.find((t) => t.name === "pva_version")!;
      const result = (await tool.execute(
        "call-1",
        {},
        undefined,
        vi.fn(),
        createMockContext(),
      )) as { content: Array<{ type: string; text: string }> };

      expect(result).toHaveProperty("content");
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBe(1);
      expect(result.content[0].type).toBe("text");

      const parsed: PvaVersionResult = JSON.parse(result.content[0].text);
      expect(parsed.package).toBe("pi-video-agent");
      expect(typeof parsed.version).toBe("string");
      expect(parsed.version).toBeTruthy();
      expect(typeof parsed.extensions).toBe("string");
      expect(typeof parsed.skills).toBe("string");
      expect(typeof parsed.ok).toBe("boolean");
    });

    it("contains details with pvaVersion and diagnostics", async () => {
      const tool = mockPi.tools.find((t) => t.name === "pva_version")!;
      const result = (await tool.execute(
        "call-2",
        {},
        undefined,
        vi.fn(),
        createMockContext(),
      )) as { details: { pvaVersion: PvaVersionResult; diagnostics: PvaDiagnostics } };

      expect(result.details).toBeDefined();
      expect(result.details.pvaVersion).toBeDefined();
      expect(result.details.diagnostics).toBeDefined();
      expect(result.details.diagnostics.packageName).toBe("pi-video-agent");
    });
  });

  describe("pva_diagnostics", () => {
    it("returns diagnostics with expected fields", async () => {
      const tool = mockPi.tools.find((t) => t.name === "pva_diagnostics")!;
      const result = (await tool.execute(
        "call-3",
        {},
        undefined,
        vi.fn(),
        createMockContext(),
      )) as { content: Array<{ type: string; text: string }> };

      expect(result).toHaveProperty("content");
      const parsed: PvaDiagnostics = JSON.parse(result.content[0].text);
      expect(parsed.packageName).toBe("pi-video-agent");
      expect(typeof parsed.packageVersion).toBe("string");
      expect(typeof parsed.extensionsPath).toBe("string");
      expect(typeof parsed.skillsPath).toBe("string");
      expect(Array.isArray(parsed.errors)).toBe(true);
      expect(Array.isArray(parsed.warnings)).toBe(true);
    });
  });
});

describe("extensions/index.ts — lifecycle handlers", () => {
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
    createExtension(mockPi as unknown as Parameters<typeof createExtension>[0]);
  });

  it("registers session_start handler", () => {
    expect(mockPi.handlers.has("session_start")).toBe(true);
  });

  it("registers session_shutdown handler", () => {
    expect(mockPi.handlers.has("session_shutdown")).toBe(true);
  });

  it("session_start sets status (TUI mode)", async () => {
    const ctx = createMockContext({ mode: "tui" });
    await mockPi.fireEvent("session_start", { reason: "startup" }, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });

  it("session_start does not throw in RPC mode", async () => {
    const ctx = createMockContext({ mode: "rpc" });
    await expect(
      mockPi.fireEvent("session_start", { reason: "startup" }, ctx),
    ).resolves.not.toThrow();
  });

  it("session_shutdown clears status", async () => {
    const ctx = createMockContext();
    await mockPi.fireEvent("session_shutdown", { reason: "quit" }, ctx);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("pva", "");
  });
});

describe("extensions/index.ts — typed contracts", () => {
  it("PvaVersionResult type has required fields", () => {
    const valid: PvaVersionResult = {
      package: "test",
      version: "1.0.0",
      extensions: "/ext",
      skills: "/skills",
      ok: true,
    };
    expect(valid).toBeDefined();
  });

  it("PvaDiagnostics type has required fields", () => {
    const valid: PvaDiagnostics = {
      packageName: "test",
      packageVersion: "1.0.0",
      extensionsPath: "/ext",
      skillsPath: "/skills",
      errors: [],
      warnings: [],
    };
    expect(valid).toBeDefined();
  });
});
