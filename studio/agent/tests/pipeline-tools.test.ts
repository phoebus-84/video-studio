import { describe, it, expect, vi, afterEach } from "vitest";
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
      "pva_request_approval",
      "pva_budget_status",
      "pva_journal",
    ]);
  });

  it("there is no pva_approve tool", () => {
    const byName = register();
    expect([...byName.keys()]).not.toContain("pva_approve");
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

/**
 * Wire-level tests: what actually crosses the HTTP boundary.
 *
 * The schema tests above pin the typebox shape, but that is only half of
 * each tool — `execute` builds the URL and body independently of the
 * declared schema, and nothing checks those match. A dropped `leaseId` in
 * the POST body, or a misspelled path segment, typechecks cleanly and
 * passes every schema-only assertion; it only breaks at runtime against a
 * real gateway. These tests stub `global.fetch` (the one seam
 * `createClient` in pipeline-tools.ts actually calls through) and assert on
 * the request it was given.
 */
describe("pipeline tools — wire calls", () => {
  const ref = { channel: "chan", series: "ser", episode: "ep1" };

  function register() {
    const registerTool = vi.fn();
    registerPipelineTools({ registerTool } as never);
    const byName = new Map(registerTool.mock.calls.map((call: any) => [call[0].name, call[0]]));
    return byName;
  }

  function stubFetch(responseBody: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pva_claim_stage posts to the claim route with the exact path segments", async () => {
    const fetchMock = stubFetch({ ok: true, outcome: { stageId: "brief", status: "claimed", leaseId: "lease-1" } });
    const tool = register().get("pva_claim_stage");

    await tool.execute("call-1", { ...ref, stageId: "brief" }, undefined, vi.fn(), undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(
      /\/api\/channels\/chan\/series\/ser\/episodes\/ep1\/stages\/brief\/claim$/,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ dryRun: false });
  });

  it("pva_claim_stage's URL breaks if the path segment is wrong (guards against a route typo)", async () => {
    const fetchMock = stubFetch({ ok: true, outcome: {} });
    const tool = register().get("pva_claim_stage");

    await tool.execute("call-1", { ...ref, stageId: "brief" }, undefined, vi.fn(), undefined);

    const [url] = fetchMock.mock.calls[0];
    // A misspelled segment like "claim-wrong-path" must NOT match this.
    expect(url).not.toMatch(/claim-wrong-path/);
    expect(url.endsWith("/stages/brief/claim")).toBe(true);
  });

  it("pva_complete_stage sends leaseId in the POST body on success", async () => {
    const fetchMock = stubFetch({ ok: true, outcome: { stageId: "brief", status: "completed" } });
    const tool = register().get("pva_complete_stage");

    await tool.execute(
      "call-1",
      { ...ref, stageId: "brief", leaseId: "lease-abc", outputs: ["brief.md"] },
      undefined,
      vi.fn(),
      undefined,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/stages\/brief\/complete$/);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.leaseId).toBe("lease-abc");
    expect(body.outputs).toEqual(["brief.md"]);
  });

  it("pva_complete_stage sends leaseId in the POST body on a failure report too", async () => {
    const fetchMock = stubFetch({ ok: true, outcome: { stageId: "brief", status: "failed" } });
    const tool = register().get("pva_complete_stage");

    await tool.execute(
      "call-1",
      { ...ref, stageId: "brief", leaseId: "lease-abc", failed: true, error: "model timed out" },
      undefined,
      vi.fn(),
      undefined,
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.leaseId).toBe("lease-abc");
    expect(body.failed).toBe(true);
    expect(body.error).toBe("model timed out");
  });

  it("pva_request_approval posts to the approve route and reports a request, not a grant", async () => {
    const fetchMock = stubFetch({
      ok: true,
      outcome: { stageId: "script", status: "requested", reason: "the operator must approve this stage" },
    });
    const tool = register().get("pva_request_approval");

    const result = await tool.execute("call-1", { ...ref, stageId: "script" }, undefined, vi.fn(), undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/stages\/script\/approve$/);
    expect(init.method).toBe("POST");
    expect(result.content[0].text).toMatch(/requested/);
  });
});
