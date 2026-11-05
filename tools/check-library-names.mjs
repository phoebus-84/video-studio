#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The application knows no library (ADR-0044).
//
// A channel's, a series' or an episode's name in a skill, a tool description
// or a guide teaches every agent that reads it one library's habits as the
// studio's rules. The application cannot list the names to forbid without
// knowing them, so this check reads them from the library on this machine,
// at check time, and looks for them in the application's tracked files.
//
// With no library here (CI, a fresh clone) it has nothing to compare and
// passes. On the operator's machine, `npm run check` runs it before a push.
//
//   node tools/check-library-names.mjs [--library <dir>] [--all]
//
// --all also reads tests, fixtures, evaluation records and the sealed kits,
// which are left out by default: they may use a name as data, and a sealed kit
// changes only as a new kit version.
//
// A name that is an ordinary word (an episode called "intro") is allowed by
// listing it, one per line, in <library>/.app-names-allowed — a file of the
// library, never of the application.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");

/** Folder names the layout itself uses: they name no library. */
const STRUCTURAL = new Set([
  "series", "episodes", "sources", "templates", "kits", "skills", "themes",
  "brand", "characters", "references", "voices", "visual-bible", "pipelines",
  "artifacts", "assets", "output", "journal", "reviews", "attempts", "prompts",
  "source", "test", "tests", "demo", "sample", "example", "default",
]);

const SCANNED = /^(studio|packages|skills|tools|docs)\/|^(README\.md|CLAUDE\.md|\.mcp\.json|compose\.config\.json)$|^\.claude\//;
const TESTS = /(^|\/)(test|tests|__tests__|fixtures|evaluation)(\/|$)|\.test\.[a-z]+$/;
const SEALED = /^packages\/remotion-composer\/(src\/kits|previews)\//;
const SKIPPED = /(^|\/)(\.beads|node_modules|dist)(\/|$)|(^|\/)bun\.lock$|kits\.lock\.json$/;
const BINARY = /\.(png|jpe?g|gif|webp|mp3|mp4|wav|zip|ico|woff2?|ttf|otf|pdf|blend)$/i;

const dirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || (e.isSymbolicLink() && statSync(join(dir, e.name)).isDirectory())) && !/^[._]/.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
};

/** The `title:` of a small metadata file, if it has one. */
function titleOf(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf-8").slice(0, 4000);
  const yaml = text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const json = text.trimStart().startsWith("{") ? text.match(/"title"\s*:\s*"([^"]+)"/)?.[1] : undefined;
  return (yaml ?? json ?? null)?.trim() || null;
}

/**
 * Every name a library gives: channel, series, episode, source and template
 * slugs, and the titles of more than one word. Returns `[{ name, kind }]`.
 */
export function libraryNames(libraryRoot) {
  // Keyed by the name as a slug, so a title that only spells its slug in
  // words ("My Series" for my-series) is not a second name.
  const found = new Map();
  const add = (name, kind) => {
    if (!name || name.length < 3 || STRUCTURAL.has(name.toLowerCase())) return;
    const key = name.toLowerCase().replace(/[\s_-]+/g, "-");
    if (!found.has(key)) found.set(key, { name, kind });
  };
  const addTitle = (file, kind) => {
    const title = titleOf(file);
    if (title && /\s/.test(title)) add(title, `${kind} title`);
  };
  for (const channel of dirs(libraryRoot)) {
    const ch = join(libraryRoot, channel);
    add(channel, "channel");
    addTitle(join(ch, "channel.md"), "channel");
    for (const source of dirs(join(ch, "sources"))) add(source, "source");
    for (const series of dirs(join(ch, "series"))) {
      const se = join(ch, "series", series);
      add(series, "series");
      addTitle(join(se, "series.md"), "series");
      addTitle(join(se, "series.json"), "series");
      for (const template of dirs(join(se, "templates"))) add(template, "template");
      for (const source of dirs(join(se, "sources"))) add(source, "source");
      for (const episode of dirs(join(se, "episodes"))) {
        add(episode, "episode");
        addTitle(join(se, "episodes", episode, "episode.yaml"), "episode");
      }
    }
  }
  return [...found.values()];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A slug also matches as words ("my-series" as "my series"); a title as written. */
function patternFor(name) {
  const forms = new Set([name]);
  if (name.includes("-")) forms.add(name.replace(/-/g, " "));
  const alternatives = [...forms].map((f) => escape(f).replace(/ /g, "\\s+"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

/**
 * `files` is `[{ path, text }]`. Returns `[{ path, line, name, kind }]`, one
 * per name per line.
 */
export function findNames(files, names, allowed = new Set()) {
  const checks = names
    .filter(({ name }) => !allowed.has(name.toLowerCase()))
    .map((n) => ({ ...n, re: patternFor(n.name) }));
  const hits = [];
  for (const { path, text } of files) {
    const lines = text.split("\n");
    for (const check of checks) {
      if (!check.re.test(text)) continue;
      lines.forEach((line, i) => {
        if (check.re.test(line)) hits.push({ path, line: i + 1, name: check.name, kind: check.kind });
      });
    }
  }
  return hits;
}

function trackedFiles({ all }) {
  const listed = execSync("git ls-files", { cwd: ROOT, encoding: "utf-8" }).trim().split("\n").filter(Boolean);
  return listed.filter((f) =>
    SCANNED.test(f) && !SKIPPED.test(f) && !BINARY.test(f) && (all || (!TESTS.test(f) && !SEALED.test(f))));
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const flag = args.indexOf("--library");
  const given = flag >= 0 ? args[flag + 1] : process.env.AVG_LIBRARY_ROOT ?? join(ROOT, "library");
  if (!given || !existsSync(given)) {
    console.log("✓ No library on this machine: no library names to look for.");
    return;
  }
  const libraryRoot = realpathSync(given);
  const names = libraryNames(libraryRoot);
  const allowFile = join(libraryRoot, ".app-names-allowed");
  const allowed = new Set(existsSync(allowFile)
    ? readFileSync(allowFile, "utf-8").split("\n").map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#"))
    : []);

  const files = [];
  for (const path of trackedFiles({ all })) {
    let text;
    try {
      text = readFileSync(join(ROOT, path), "utf-8");
    } catch {
      continue;
    }
    if (text.length <= 2_000_000) files.push({ path, text });
  }

  const hits = findNames(files, names, allowed);
  if (!hits.length) {
    console.log(`✓ The application names none of the ${names.length} names in the library${all ? " (tests and sealed kits included)" : ""}.`);
    return;
  }
  console.error(`✗ ${hits.length} line(s) of the application name something in the library:\n`);
  for (const h of hits) console.error(`  ${h.path}:${h.line}  ${h.kind} "${h.name}"`);
  console.error(
    "\nMove a channel's or a series' rule into its own skill in the library, and use a neutral example in the" +
    `\napplication. A name that is an ordinary word can be listed in ${allowFile}.`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
