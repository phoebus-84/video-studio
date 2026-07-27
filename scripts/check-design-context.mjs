import { readFile } from "node:fs/promises";
import { validateDesignContext } from "./design-context-validator.mjs";

const [product, design, brief] = await Promise.all([
  readFile(new URL("../PRODUCT.md", import.meta.url), "utf8"),
  readFile(new URL("../DESIGN.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/SHAPE-BRIEF.md", import.meta.url), "utf8"),
]);

const diagnostics = validateDesignContext({ product, design, brief });
if (diagnostics.length > 0) {
  for (const item of diagnostics) {
    process.stderr.write(`${JSON.stringify(item)}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("Design context is complete and approved.\n");
}
