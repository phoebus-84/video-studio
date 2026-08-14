import { test, expect } from "@playwright/test";

/**
 * End-to-end MVP journey tests.
 * All journeys use deterministic fixture data. No real services,
 * credentials, or model downloads are required.
 */

test("journey: discover library and open a running episode", async ({
  page,
}) => {
  await page.goto("/");

  /* Library shows channels. */
  await expect(page.getByText("Tech Explainer")).toBeVisible();

  /* Expand channel → series → click episode. */
  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Episode workspace loaded. */
  await expect(
    page.getByText("Memory Hierarchies Explained").first(),
  ).toBeVisible();

  /* Stage rail visible with auto-selected running stage. */
  await expect(page.getByText("Illustrations")).toBeVisible();
  const selected = page.locator(
    'nav[aria-label="Pipeline stages"] button[aria-current="step"]',
  );
  await expect(selected).toBeVisible();

  /* Bottom panel with tabs. */
  await expect(page.getByRole("tab", { name: "Storyboard" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Narration" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Render" })).toBeVisible();

  /* Inspector with tabs. */
  await expect(page.getByRole("tab", { name: "Assets" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Reviews" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Status" })).toBeVisible();
});

test("journey: inspect scene assets in inspector", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Click scene 1 in storyboard. */
  await page.getByText("The Memory Problem", { exact: true }).click();

  /* Inspector should show asset attempts. */
  await expect(
    page.getByText("Assets — The Memory Problem"),
  ).toBeVisible();
  await expect(page.getByText("attempt-1a")).toBeVisible();

  /* Selected attempt visible. */
  await expect(page.getByText("Selected").first()).toBeVisible();
});

test("journey: review narration segments", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Switch to narration tab. */
  await page.getByRole("tab", { name: "Narration" }).click();

  await expect(page.getByText("Default Narrator")).toBeVisible();
  await expect(page.getByText("seg-1")).toBeVisible();

  /* Play button available for ready segments. */
  const playBtns = page.locator("button[aria-label*='Play segment']");
  expect(await playBtns.count()).toBeGreaterThanOrEqual(2);
});

test("journey: inspect render quality report", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Switch to render tab. */
  await page.getByRole("tab", { name: "Render" }).click();

  await expect(page.getByText("Current Deliverable")).toBeVisible();
  await expect(page.getByText("Quality Report")).toBeVisible();

  /* Multiple QA findings. */
  await expect(page.getByText("RESOLUTION_MATCH")).toBeVisible();
  await expect(page.getByText("CAPTIONS_PRESENT")).toBeVisible();
});

test("journey: edit an artifact and discard changes", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Select Brief stage. */
  await page.getByText("Brief").click();

  const textarea = page.locator("textarea[aria-label='brief']");
  const original = await textarea.inputValue();

  /* Edit. */
  await textarea.fill("changed content");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  /* Discard. */
  await page.getByText("Discard").click();
  const reverted = await textarea.inputValue();
  expect(reverted).toBe(original);
});

test("journey: check blocked episode and review blocker", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("Deep Dives").click();
  await page.getByText("Cache Coherence Protocols").click();

  /* Blocked reason in header. */
  await expect(page.getByText(/quota exceeded/)).toBeVisible();

  /* Status tab shows blocker details. */
  await page.getByRole("tab", { name: "Status" }).click();
  await expect(page.getByText("Blocked: Illustrations")).toBeVisible();
  await expect(page.getByText("Retry")).toBeVisible();
  await expect(page.getByText("Skip stage")).toBeVisible();
});

test("journey: check stale episode staleness analysis", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("CPU Pipelines and Branch Prediction").click();

  /* Stale count in header. */
  await expect(page.getByText("2 stages stale").first()).toBeVisible();

  /* Status tab shows staleness. */
  await page.getByRole("tab", { name: "Status" }).click();
  await expect(
    page.getByRole("heading", { name: "Staleness" }),
  ).toBeVisible();
  await expect(page.getByText("Rerun affected")).toBeVisible();
  await expect(page.getByText("Accept staleness")).toBeVisible();
});

test("journey: open review inbox and read a thread", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Reviews tab. */
  await page.getByRole("tab", { name: "Reviews" }).click();

  await expect(page.getByText("2 open")).toBeVisible();

  /* Expand a thread. */
  await page
    .locator("button", { has: page.getByText("scene-3") })
    .click();
  await expect(page.getByText(/Regenerated scene 3/)).toBeVisible();
  await expect(page.getByPlaceholder("Reply or send to Pi…")).toBeVisible();
});
