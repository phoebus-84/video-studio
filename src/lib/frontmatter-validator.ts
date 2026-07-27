import type { EditorDiagnostic } from "$lib/editor-types";

/**
 * Validate YAML frontmatter in a Markdown document.
 * Expects the form:
 *   ---
 *   key: value
 *   ---
 *   body...
 */
export function validateFrontmatter(text: string): EditorDiagnostic[] {
  const diags: EditorDiagnostic[] = [];

  if (!text.startsWith("---")) {
    diags.push({
      code: "FRONTMATTER_MISSING",
      message: "Document must start with YAML frontmatter (---).",
      line: 1,
      severity: "error",
    });
    return diags;
  }

  const lines = text.split("\n");
  const closingIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");

  if (closingIdx === -1) {
    diags.push({
      code: "FRONTMATTER_UNCLOSED",
      message: "YAML frontmatter is not closed with ---.",
      line: lines.length,
      severity: "error",
    });
    return diags;
  }

  /* Basic YAML key validation — indentation and colon. */
  for (let i = 1; i < closingIdx; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    if (line.trim().startsWith("#")) continue;

    /* List items are fine. */
    if (/^\s*-\s/.test(line)) continue;

    if (!line.includes(":")) {
      diags.push({
        code: "YAML_SYNTAX",
        message: "Expected key: value syntax.",
        line: i + 1,
        severity: "error",
      });
    }

    /* Indentation check: must be multiple of 2. */
    const indent = line.length - line.trimStart().length;
    if (indent % 2 !== 0) {
      diags.push({
        code: "YAML_INDENT",
        message: "Indentation must be a multiple of 2 spaces.",
        line: i + 1,
        severity: "warning",
      });
    }
  }

  /* Check body exists after frontmatter. */
  const body = lines.slice(closingIdx + 1).join("\n").trim();
  if (!body) {
    diags.push({
      code: "BODY_EMPTY",
      message: "Document body is empty after frontmatter.",
      line: closingIdx + 2,
      severity: "warning",
    });
  }

  return diags;
}
