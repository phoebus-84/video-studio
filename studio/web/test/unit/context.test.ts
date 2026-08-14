import { expect, test } from "vitest";
import { validateDesignContext } from "../../scripts/design-context-validator.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const product = readFileSync(resolve("PRODUCT.md"), "utf8");
const design = readFileSync(resolve("DESIGN.md"), "utf8");
const brief = readFileSync(resolve("docs/SHAPE-BRIEF.md"), "utf8");

const valid = Object.freeze({ product, design, brief });

test("approved context passes", () => {
  expect(validateDesignContext(valid)).toEqual([]);
});

test("placeholder marker is rejected", () => {
  const diag = validateDesignContext({
    ...valid,
    product: valid.product + "\nTODO: add more",
  });
  expect(diag.some((d) => d.code === "CONTEXT_PLACEHOLDER_FOUND")).toBe(true);
});

test("unapproved brief is rejected", () => {
  const diag = validateDesignContext({
    ...valid,
    brief: valid.brief.replace("Status: Approved", "Status: Proposed"),
  });
  expect(diag.some((d) => d.code === "BRIEF_NOT_APPROVED")).toBe(true);
});
