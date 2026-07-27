import { expect, test } from "vitest";
import { validateFrontmatter } from "$lib/frontmatter-validator";

test("valid frontmatter passes", () => {
  const diags = validateFrontmatter(
    "---\ntitle: Hello\n---\n\nBody text here.",
  );
  expect(diags).toEqual([]);
});

test("missing frontmatter is flagged", () => {
  const diags = validateFrontmatter("Just body text.");
  expect(diags.some((d) => d.code === "FRONTMATTER_MISSING")).toBe(true);
});

test("unclosed frontmatter is flagged", () => {
  const diags = validateFrontmatter("---\ntitle: Hello\nNo closing.");
  expect(diags.some((d) => d.code === "FRONTMATTER_UNCLOSED")).toBe(true);
});

test("odd indentation is warned", () => {
  const diags = validateFrontmatter(
    "---\ntitle: Hello\n  key: value\n   bad: indent\n---\n\nBody.",
  );
  expect(diags.some((d) => d.code === "YAML_INDENT")).toBe(true);
});

test("missing colon is an error", () => {
  const diags = validateFrontmatter(
    "---\ntitle Hello\n---\n\nBody.",
  );
  expect(diags.some((d) => d.code === "YAML_SYNTAX")).toBe(true);
});

test("empty body is warned", () => {
  const diags = validateFrontmatter("---\ntitle: Hello\n---\n\n");
  expect(diags.some((d) => d.code === "BODY_EMPTY")).toBe(true);
});

test("comments and list items are ignored", () => {
  const diags = validateFrontmatter(
    "---\ntitle: Hello\n# comment\n  - list item\n---\n\nBody.",
  );
  expect(diags).toEqual([]);
});
