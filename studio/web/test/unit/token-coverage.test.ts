import { expect, test, describe } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";

/**
 * Every `--vs-*` token a component references must exist in both themes.
 *
 * This is not style pedantry. `var(--vs-bg-panel, #fff)` renders a hardcoded
 * white when the token is undefined — and it is undefined in *both* themes, so
 * the dark theme silently showed white panel dividers and a white file-browser
 * toolbar. The fallback hides the mistake instead of surfacing it, which is
 * exactly the failure mode that made this hard to spot by eye.
 */

const SRC = resolve("src");
const TOKENS = resolve("src/tokens/design-tokens.css");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return [".svelte", ".css", ".ts"].includes(extname(path)) ? [path] : [];
  });
}

const css = readFileSync(TOKENS, "utf8");

/** Tokens declared under a given selector block. */
function declaredIn(selector: string): Set<string> {
  const start = css.indexOf(selector);
  if (start === -1) return new Set();
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  const block = css.slice(open, close);
  return new Set([...block.matchAll(/(--vs-[\w-]+)\s*:/g)].map((m) => m[1]!));
}

const base = declaredIn(":root {");
const light = declaredIn(':root,\n[data-theme="light"]');
const dark = declaredIn('[data-theme="dark"]');

const referenced = new Map<string, string[]>();
for (const file of walk(SRC)) {
  if (file === TOKENS) continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/var\((--vs-[\w-]+)/g)) {
    const name = match[1]!;
    referenced.set(name, [...(referenced.get(name) ?? []), file]);
  }
}

describe("design token coverage", () => {
  test("every referenced token is defined", () => {
    const defined = new Set([...base, ...light, ...dark]);
    const missing = [...referenced.keys()]
      .filter((name) => !defined.has(name))
      .map((name) => `${name} (used in ${referenced.get(name)!.length} file(s))`);

    expect(missing).toEqual([]);
  });

  test("every themed token has a dark counterpart", () => {
    /* A token defined only in the light block keeps its light value in dark
       theme, which is the same bug wearing a different hat. */
    const lightOnly = [...light].filter((name) => !dark.has(name) && !base.has(name));
    expect(lightOnly).toEqual([]);
  });

  test("both themes are actually populated", () => {
    expect(light.size).toBeGreaterThan(20);
    expect(dark.size).toBeGreaterThan(20);
  });
});
