import { test, expect, type Page } from "@playwright/test";

const BASE = "/api/channels/test-channel/series/test-series/episodes/test-episode";

async function setup(page: Page, options: { operator?: boolean; state?: string; refused?: boolean; holdAction?: Promise<void> } = {}) {
  let state = options.state ?? "awaiting_review";
  const posts: string[] = [];
  await page.addInitScript(({ operator }) => {
    localStorage.setItem("vs-gateway-url", "http://studio-gateway.test");
    localStorage.setItem("vs-gateway-token", "test-agent-only");
    if (operator) localStorage.setItem("vs-operator-key", "test-operator-only");
  }, { operator: options.operator ?? false });
  await page.route("http://studio-gateway.test/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const respond = (body: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json",
      headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body),
    });
    if (req.method() === "OPTIONS") return respond({});
    if (req.method() === "POST") {
      posts.push(path);
      if (options.refused) return respond({ ok: false, error: { code: "REVIEW_REFUSED", message: "Outputs changed — review the new candidate" } });
      await (options.holdAction ?? Promise.resolve());
      if (path === `${BASE}/stages/preparation/approve`) {
        const signed = req.headers().authorization === "Bearer test-operator-only";
        if (signed) state = "completed";
        return respond({ ok: true, outcome: { stageId: "preparation", status: signed ? "approved" : "requested",
          ...(signed ? {} : { reason: "Approval requested — sign in as operator to approve" }) } });
      }
      if (path === `${BASE}/stages/preparation/execute`) {
        state = "completed";
        return respond({ ok: true, outcome: { stageId: "preparation", status: "completed", outputs: ["script.md"] } });
      }
      return respond({ message: "Unexpected action" }, 400);
    }
    if (path === "/api/channels") return respond([{ slug: "test-channel", title: "Test Channel", seriesCount: 1 }]);
    if (path === "/api/channels/test-channel/series") return respond([{ slug: "test-series", title: "Test Series", episodeCount: 1 }]);
    if (path === "/api/channels/test-channel/series/test-series/episodes") return respond([{ slug: "test-episode", title: "Test Episode", status: "awaiting_review", currentDeliverable: false, blocked: false, lastActivity: "2026-09-28T00:00:00Z" }]);
    if (path === BASE) return respond({ slug: "test-episode", title: "Test Episode", status: "awaiting_review", pipeline: "test-pipeline", scenes: [], stages: [
      { id: "preparation", name: "Preparation", status: state, dependsOn: [] },
    ] });
    if (path === `${BASE}/status`) return respond({ ok: true, data: { pipeline: "test-pipeline", stages: [
      { stageId: "preparation", state, produces: ["script.md"], dependsOn: [],
        ...(state === "blocked" ? { stateReason: "Upstream input is missing" } : {}) },
    ] } });
    if (path.endsWith("/staleness")) return respond({ stale: [], affected: [] });
    return respond({ error: "NOT_FOUND", message: "Not needed by this isolated fixture" }, 404);
  });
  await page.goto("/");
  const library = page.getByRole("navigation", { name: "Library", exact: true });
  await library.getByRole("button", { name: "Test Channel", exact: true }).click();
  await library.getByRole("button", { name: "Test Series 1 episodes", exact: true }).click();
  await library.getByRole("button", { name: "Test Episode Review", exact: true }).click();
  await expect(page.locator(".stage-detail h2")).toHaveText("Preparation");
  return posts;
}

test("the canvas Approve button calls the real store route, then refreshes the canvas and rail", async ({ page }) => {
  const posts = await setup(page, { operator: true });
  const detail = page.locator(".stage-detail");
  await detail.getByRole("button", { name: "Approve stage", exact: true }).click();
  await expect(detail.getByRole("status")).toHaveText("preparation approved");
  expect(posts).toEqual([`${BASE}/stages/preparation/approve`]);
  await expect(detail.locator(".sd-state")).toHaveText("Done");
  await expect(page.locator(".stage-item").first()).toHaveAttribute("aria-label", "Preparation — completed");
  await expect(detail.getByRole("button", { name: "Rerun stage" })).toBeEnabled();
});

test("agent credentials request approval but never show a completed stage", async ({ page }) => {
  const posts = await setup(page);
  const detail = page.locator(".stage-detail");
  await expect(detail.getByText(/Sign in as operator in the header/)).toBeVisible();
  await detail.getByRole("button", { name: "Approve stage", exact: true }).click();
  await expect(detail.getByRole("status")).toContainText("Approval requested");
  await expect(detail.locator(".sd-state")).toHaveText("Awaiting review");
  expect(posts).toEqual([`${BASE}/stages/preparation/approve`]);
  await expect(detail.getByRole("button", { name: "Approve stage", exact: true })).toBeEnabled();
});

test("approval refusal is shown beside the button, not swallowed", async ({ page }) => {
  await setup(page, { operator: true, refused: true });
  const detail = page.locator(".stage-detail");
  await detail.getByRole("button", { name: "Approve stage", exact: true }).click();
  await expect(detail.getByRole("alert")).toHaveText("Outputs changed — review the new candidate");
  await expect(detail.locator(".sd-state")).toHaveText("Awaiting review");
});

test("Run stage executes the selected stage and disables duplicate clicks", async ({ page }) => {
  let release!: () => void;
  const holdAction = new Promise<void>((resolve) => { release = resolve; });
  const posts = await setup(page, { state: "runnable", holdAction });
  const detail = page.locator(".stage-detail");
  await detail.getByRole("button", { name: "Run stage", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Working…" })).toBeDisabled();
  release();
  await expect(detail.getByRole("status")).toContainText("preparation completed");
  expect(posts).toEqual([`${BASE}/stages/preparation/execute`]);
});

test("a blocked stage explains the blocker and offers no fake Fix and retry action", async ({ page }) => {
  const posts = await setup(page, { state: "blocked" });
  const detail = page.locator(".stage-detail");
  await expect(detail.getByText("Upstream input is missing")).toBeVisible();
  await expect(detail.locator(".sd-actions button")).toHaveCount(0);
  expect(posts).toEqual([]);
});
