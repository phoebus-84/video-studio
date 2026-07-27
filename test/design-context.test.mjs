import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateDesignContext } from "../scripts/design-context-validator.mjs";

const validContext = Object.freeze({
  product: await readFile(new URL("../PRODUCT.md", import.meta.url), "utf8"),
  design: await readFile(new URL("../DESIGN.md", import.meta.url), "utf8"),
  brief: await readFile(
    new URL("../docs/SHAPE-BRIEF.md", import.meta.url),
    "utf8",
  ),
});

function codes(context) {
  return validateDesignContext(context).map((item) => item.code);
}

test("approved repository context passes validation", () => {
  assert.deepEqual(validateDesignContext(validContext), []);
});

test("placeholder product context is rejected", () => {
  assert.ok(
    codes({ ...validContext, product: `${validContext.product}\nTODO` }).includes(
      "CONTEXT_PLACEHOLDER_FOUND",
    ),
  );
});

test("missing required design section is rejected", () => {
  assert.ok(
    codes({
      ...validContext,
      design: validContext.design.replace("## Elevation", "### Elevation"),
    }).includes("DESIGN_SECTION_MISSING"),
  );
});

test("brief without explicit approval is rejected", () => {
  assert.ok(
    codes({
      ...validContext,
      brief: validContext.brief.replace("Status: Approved", "Status: Proposed"),
    }).includes("BRIEF_NOT_APPROVED"),
  );
});

test("brief without resolved visual-probe gate is rejected", () => {
  assert.ok(
    codes({
      ...validContext,
      brief: validContext.brief.replace(
        "**Visual probe:** Skipped because",
        "Visual exploration was discussed because",
      ),
    }).includes("IMAGE_GATE_UNRESOLVED"),
  );
});

test("missing blocker-recovery journey is rejected", () => {
  const briefWithoutBlockerTerms = validContext.brief.replaceAll(
    /block(?:ed|er|ing)?/gi,
    "halt",
  );
  assert.ok(
    codes({ ...validContext, brief: briefWithoutBlockerTerms }).includes(
      "BRIEF_JOURNEY_BLOCKER_MISSING",
    ),
  );
});
