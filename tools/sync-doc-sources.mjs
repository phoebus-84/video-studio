#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Copies each component's own Markdown into docs/reference/<name>/.
//
// VitePress can only serve files inside its source directory, but the real
// documentation lives next to the code it describes — where it belongs, and
// where it actually gets updated. Rather than duplicating it by hand or
// littering the site with links that 404, this syncs it in at build time.
//
// The directory structure is preserved (docs/API.md stays at docs/api.md) so
// that relative links between those files keep working. Only the case is
// normalised, because the sources mix API.md and operator-guide.md and URLs
// must be stable on case-sensitive hosts. Link targets are lowercased to match.
//
// docs/reference/ is generated and gitignored: the copy under docs/ is a build
// artifact, and the component's own files stay the single source of truth.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, rmSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "compose.config.json"), "utf-8"));
const OUT = join(ROOT, "docs", "reference");

const SKIP = new Set([
  "node_modules", ".git", ".beads", ".venv", "dist", ".svelte-kit",
  "models", "voices", "evaluation", "test", "tests", "__tests__",
  "fixtures", "coverage", "site",
]);

/** Every .md under a component, excluding build and test noise. */
function* markdown(dir, base = dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdown(full, base);
    else if (entry.name.endsWith(".md")) yield relative(base, full);
  }
}

/**
 * Rewrite relative Markdown links so they resolve inside the built site.
 *
 * Two things need fixing. Case, because the sources mix `API.md` with
 * `operator-guide.md` and URLs must be stable on case-sensitive hosts. And
 * links that escape the component — a file may correctly point at
 * `../../../docs/workspace.md` for someone browsing the repository, but that
 * path means something else once the file is copied under docs/reference/.
 * Those are resolved against the original location and re-emitted as
 * site-absolute links.
 *
 * @param text     file contents
 * @param fromDir  the file's real directory, used to resolve relative targets
 * @param compDir  the component root; links above it have escaped
 */
function rewriteLinks(text, fromDir, compDir) {
  const siteDocs = join(ROOT, "docs");

  return text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (whole, label, target) => {
    if (/^(https?:|mailto:|#|\/)/i.test(target)) return whole;

    const [rawPath, hash] = target.split("#");
    if (!rawPath) return whole;

    const suffix = hash ? `#${hash}` : "";
    const absolute = resolve(fromDir, rawPath);

    // Still inside the component: keep it relative, just normalise case.
    if (!relative(compDir, absolute).startsWith("..")) {
      return `[${label}](${rawPath.toLowerCase()}${suffix})`;
    }

    // Escaped into the hand-written site pages: link to them directly.
    if (!relative(siteDocs, absolute).startsWith("..")) {
      const page = relative(siteDocs, absolute).replace(/\.md$/i, "").toLowerCase();
      return `[${label}](/${page}${suffix})`;
    }

    // Escaped somewhere the site does not publish. Keep the words, drop the
    // link, and say where the file actually lives so the reader can still find
    // it in the repository.
    const where = relative(ROOT, absolute);
    return `${label} (\`${where}\` in the repository)`;
  });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let files = 0;
const synced = [];

for (const [name, component] of Object.entries(CONFIG.components)) {
  const src = join(ROOT, component.path);
  if (!existsSync(src)) continue;

  let count = 0;
  for (const rel of markdown(src)) {
    const target = join(OUT, name, rel.toLowerCase());
    mkdirSync(dirname(target), { recursive: true });
    const from = dirname(join(src, rel));
    writeFileSync(target, rewriteLinks(readFileSync(join(src, rel), "utf-8"), from, src));
    count++;
    files++;
  }
  if (count) synced.push([name, component, count]);
}

writeFileSync(
  join(OUT, "index.md"),
  [
    "# Component reference",
    "",
    "These pages are **copied** from each component's own Markdown when the site",
    "is built. Edit them where they live, next to the code they describe —",
    "changes made here are overwritten.",
    "",
    ...synced.map(([name, c, count]) => `- [${name}](./${name}/readme) — ${c.summary} _(${count} pages)_`),
    "",
  ].join("\n"),
);

console.log(`✓ Synced ${files} source document(s) from ${synced.length} components into docs/reference/`);
