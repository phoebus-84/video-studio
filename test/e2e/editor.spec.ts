import { test, expect } from "@playwright/test";

test("selecting the script stage opens the editor with content", async ({
  page,
}) => {
  await page.goto("/");

  /* Navigate to running episode. */
  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();

  /* Click the Script stage. */
  await page.getByText("Script").click();

  /* Editor should be visible with frontmatter content. */
  const textarea = page.locator("textarea[aria-label='script']");
  await expect(textarea).toBeVisible();
  const value = await textarea.inputValue();
  expect(value).toContain("title:");
  expect(value).toContain("Memory Hierarchies Explained");
});

test("editing marks the document as dirty", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();
  await page.getByText("Brief").click();

  /* Dirty state should be clean initially. */
  await expect(page.getByText("Saved").first()).toBeVisible();

  /* Edit the textarea. */
  const textarea = page.locator("textarea[aria-label='brief']");
  await textarea.fill("changed content");

  /* Should show unsaved. */
  await expect(page.getByText("Unsaved changes")).toBeVisible();
});

test("discard button reverts changes", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();
  await page.getByText("Brief").click();

  const textarea = page.locator("textarea[aria-label='brief']");
  const original = await textarea.inputValue();

  await textarea.fill("changed");
  await expect(page.getByText("Discard")).toBeVisible();

  await page.getByText("Discard").click();

  /* Should revert. */
  const reverted = await textarea.inputValue();
  expect(reverted).toBe(original);
  await expect(page.getByText("Saved").first()).toBeVisible();
});

test("save button is disabled when clean", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Tech Explainer").click();
  await page.getByText("How It Works").click();
  await page.getByText("Memory Hierarchies Explained").click();
  await page.getByText("Brief").click();

  const saveBtn = page.getByRole("button", { name: "Save" });
  await expect(saveBtn).toBeDisabled();
});
