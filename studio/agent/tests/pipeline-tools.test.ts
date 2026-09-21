import { describe, it, expect, vi } from "vitest";
import { registerPipelineTools } from "../src/pipeline-tools.js";

/**
 * Registration-shape smoke test, following the pattern in
 * blender-tools.test.ts: a fake ExtensionAPI that just records what
 * `registerTool` was called with, so the tool schemas can be inspected
 * without a real Pi runtime or gateway.
 */
describe("pipeline tools", () => {
  function register() {
    const registerTool = vi.fn();
    registerPipelineTools({ registerTool } as never);
    const byName = new Map(registerTool.mock.calls.map((call: any) => [call[0].name, call[0]]));
    return byName;
  }

  it("registers all ten pipeline tools, including claim and complete", () => {
    const byName = register();
    expect([...byName.keys()]).toEqual([
      "pva_snapshot",
      "pva_run_stage",
      "pva_claim_stage",
      "pva_complete_stage",
      "pva_run_pipeline",
      "pva_check_staleness",
      "pva_plan_rerun",
      "pva_approve",
      "pva_budget_status",
      "pva_journal",
    ]);
  });

  it("requires leaseId on pva_complete_stage — omitting it must not validate", () => {
    const byName = register();
    const tool = byName.get("pva_complete_stage");
    const required: string[] = tool.parameters.required ?? [];
    expect(required).toContain("leaseId");
  });

  it("pva_plan_rerun's mode union matches RerunMode, not the old rerun-affected typo", () => {
    const byName = register();
    const tool = byName.get("pva_plan_rerun");
    const modeSchema = tool.parameters.properties.mode;
    // Optional wraps the union — pull the literal values out of whichever
    // shape typebox produced (anyOf branches carry the `const`).
    const literals = (modeSchema.anyOf ?? [modeSchema]).map((branch: any) => branch.const);
    expect(literals.sort()).toEqual([
      "full-rebuild",
      "rerun-affected-downstream",
      "rerun-selected",
      "retry-current",
    ]);
    expect(literals).not.toContain("rerun-affected");
  });

  it("pva_check_staleness says staleness is unimplemented, not that the result is authoritative", () => {
    const byName = register();
    const tool = byName.get("pva_check_staleness");
    expect(tool.description).toMatch(/not implemented/i);
    expect(tool.description).toMatch(/avg-33r/);
  });

  it("pva_run_stage and pva_run_pipeline no longer claim they run every stage", () => {
    const byName = register();
    expect(byName.get("pva_run_stage").description).toMatch(/blocked/i);
    expect(byName.get("pva_run_pipeline").description).toMatch(/stopping at the first stage/i);
  });
});
