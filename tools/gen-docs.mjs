#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Generates one reference page per component from compose.config.json and
// what is actually on disk.
//
// These pages are entry points, not copies: each component keeps its own
// README and docs/ describing its internals, and this routes you there. The
// facts that must not drift — capabilities, requirements, package name, tier —
// come from the composition manifest, so a page cannot disagree with what the
// composer will actually do.
//
//   node tools/gen-docs.mjs [--check]
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "compose.config.json"), "utf-8"));
const checkOnly = process.argv.includes("--check");

const drift = [];

/** Terms that should keep their capitalisation in a title. */
const ACRONYMS = new Map(
  [
    "API", "CLI", "TTS", "QA", "VHS", "SVG", "MP4", "RPC", "UX", "IO", "ADR",
    "MLX", "FFmpeg", "macOS", "JSON", "YAML", "SRT",
  ].map((a) => [a.toLowerCase(), a]),
);

/** "ADVISORY-DIAGNOSTICS.md" -> "Advisory diagnostics"; "API.md" -> "API". */
function titleFor(filename) {
  const words = filename.replace(/\.md$/i, "").split(/[-_]/);
  return words
    .map((word, i) => {
      const known = ACRONYMS.get(word.toLowerCase());
      if (known) return known;
      const lower = word.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

for (const [name, component] of Object.entries(CONFIG.components)) {
  const dir = join(ROOT, component.path);
  const pkgPath = join(dir, "package.json");
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf-8")) : null;

  const profiles = Object.entries(CONFIG.profiles)
    .filter(([, p]) => p.components.includes(name))
    .map(([n]) => n);

  const inTree = existsSync(join(dir, "docs"))
    ? readdirSync(join(dir, "docs")).filter((f) => f.endsWith(".md")).sort()
    : [];

  // Link into the synced copies under docs/reference/ rather than at the
  // component's real path: VitePress can only serve files inside docs/, so a
  // link to ../../packages/voice/docs/API.md would 404 in the built site.
  // sync-doc-sources.mjs preserves each component's structure under
  // docs/reference/<name>/, lowercased.
  const rel = (p) => `../reference/${name}/${p.toLowerCase()}`;
  const tier = component.standalone ? "packages" : "studio";

  const lines = [];
  lines.push(`# ${name}`);
  lines.push("");
  lines.push(`> ${component.summary}`);
  lines.push("");
  lines.push("|  |  |");
  lines.push("|---|---|");
  lines.push(`| Path | \`${component.path}\` |`);
  if (pkg?.name) lines.push(`| Package | \`${pkg.name}\` |`);
  lines.push(`| Kind | ${component.kind} |`);
  lines.push(
    `| Tier | ${component.standalone ? "**reusable** — usable outside this project" : "studio — part of the product"} |`,
  );
  lines.push(`| Capabilities | ${component.capabilities.length ? component.capabilities.map((c) => `\`${c}\``).join(", ") : "—"} |`);

  const reqs = [
    ...(component.requires?.system ?? []).map((s) => `\`${s}\` on PATH`),
    ...(component.requires?.env ?? []).map((e) => `\`${e}\` in the environment`),
  ];
  lines.push(`| Requires | ${reqs.length ? reqs.join(", ") : "nothing beyond Node"} |`);
  lines.push(`| In profiles | ${profiles.map((p) => `\`${p}\``).join(", ")} |`);
  lines.push("");

  if (component.standalone) {
    lines.push("## Using it outside this project");
    lines.push("");
    lines.push(
      "This is a reusable tool. It does not know what an episode, a series or a",
      "pipeline is, and it must never learn — `npm run check:boundaries` fails if",
      "it grows a dependency on `studio/*`. Studio-specific integration lives in",
      "[`studio/agent`](../studio/agent.md).",
    );
    lines.push("");
  } else {
    lines.push("## Role in the studio");
    lines.push("");
    lines.push(
      "Part of the product rather than a standalone tool. It may depend on any",
      "package in `packages/`, and on other studio modules.",
    );
    lines.push("");
  }

  lines.push("## Reference");
  lines.push("");
  if (existsSync(join(dir, "README.md"))) lines.push(`- [Charter and overview](${rel("README.md")})`);
  for (const doc of inTree) lines.push(`- [${titleFor(doc)}](${rel(`docs/${doc}`)})`);
  if (!inTree.length && !existsSync(join(dir, "README.md"))) {
    lines.push("_No in-tree documentation yet._");
  }
  lines.push("");

  if (pkg?.scripts) {
    lines.push("## Commands");
    lines.push("");
    lines.push("```bash");
    for (const s of ["build", "test", "typecheck", "check"].filter((s) => pkg.scripts[s])) {
      lines.push(`npm run ${s} --workspace ${pkg.name}`);
    }
    lines.push("```");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("_Generated by `tools/gen-docs.mjs` from `compose.config.json`. Edit those, not this file._");
  lines.push("");

  const out = join(ROOT, "docs", tier, `${name}.md`);
  const body = lines.join("\n");

  mkdirSync(join(ROOT, "docs", tier), { recursive: true });

  if (checkOnly) {
    const current = existsSync(out) ? readFileSync(out, "utf-8") : null;
    if (current !== body) drift.push(`docs/${tier}/${name}.md`);
  } else {
    writeFileSync(out, body);
    console.log(`  wrote docs/${tier}/${name}.md`);
  }
}

// ── The decision-record index ───────────────────────────────────────────────
//
// One row per ADR, with the first sentence of its Status section, so a reader
// (or an agent) sees which decisions still hold before reading any of them.
// An ADR without a Status section fails the check: its standing is unknown.

{
  const adrDir = join(ROOT, "docs", "adr");
  const rows = [];
  for (const file of readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
    const text = readFileSync(join(adrDir, file), "utf-8");
    const title = (text.match(/^# (.+)$/m)?.[1] ?? file).replace(/^ADR-\d{4}:\s*/, "").trim();
    const status = text.match(/^## Status\s*\n+([\s\S]*?)(?:\n\s*\n|\n## |$)/m)?.[1];
    if (!status) {
      drift.push(`docs/adr/${file} has no "## Status" section`);
      continue;
    }
    const oneLine = status.replace(/\s*\n\s*/g, " ").trim();
    const first = oneLine.match(/^.*?\.(?=\s|$)/)?.[0] ?? oneLine;
    rows.push(`| [${file.slice(0, 4)}](./${file.replace(/\.md$/, "")}) | ${title.replace(/\|/g, "\\|")} | ${first.replace(/\|/g, "\\|")} |`);
  }
  const body = [
    "# Decision records",
    "",
    "Each record keeps the decision as it was taken; its Status says whether it",
    "still holds. Read the Status before the decision: a superseded or amended",
    "record describes code that has since changed.",
    "",
    "| ADR | Decision | Status |",
    "|---|---|---|",
    ...rows,
    "",
    "_Generated by `tools/gen-docs.mjs` from the records' Status sections. Edit those, not this file._",
    "",
  ].join("\n");
  const out = join(adrDir, "index.md");
  if (checkOnly) {
    const current = existsSync(out) ? readFileSync(out, "utf-8") : null;
    if (current !== body) drift.push("docs/adr/index.md");
  } else {
    writeFileSync(out, body);
    console.log("  wrote docs/adr/index.md");
  }
}

if (checkOnly) {
  if (drift.length) {
    console.error(`✗ ${drift.length} generated doc(s) out of date:\n`);
    for (const d of drift) console.error(`  ${d}`);
    console.error("\nRun `node tools/gen-docs.mjs`.");
    process.exit(1);
  }
  console.log("✓ Generated docs are up to date.");
}
