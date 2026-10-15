// ---------------------------------------------------------------------------
// The composed skill sets, laid out the way Claude Code reads skills.
// ---------------------------------------------------------------------------
// Pi reads .pi/skills/<file>.md or <dir>/SKILL.md. Claude Code reads only
// .claude/skills/<name>/SKILL.md, with `name` and `description` in the front
// matter. Both copies come from the same sources (skills/shared,
// skills/studio, and the agent's own skills); neither is edited by hand.
//
// .claude/skills/ may hold a person's own project skills too, so only the
// directories this script wrote last time (listed in .pva-synced.json) are
// replaced.
// ---------------------------------------------------------------------------

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

export const MANIFEST = ".pva-synced.json";

/** The front matter block of a markdown file, or null. */
function frontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  return match ? { block: match[1], rest: text.slice(match[0].length) } : null;
}

function field(block, name) {
  const match = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(block);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
}

function quote(value) {
  return JSON.stringify(value);
}

/**
 * A single-file skill as SKILL.md text: its own front matter when it has
 * name and description, else front matter made from its file name and first
 * heading (the body is kept as is).
 */
export function skillText(stem, text) {
  const fm = frontMatter(text);
  const name = fm ? field(fm.block, "name") : null;
  const description = fm ? field(fm.block, "description") : null;
  if (name && description) return text;

  const body = fm ? fm.rest : text;
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const lines = [
    `name: ${name ?? stem}`,
    `description: ${description ? quote(description) : quote(heading ?? stem)}`,
  ];
  if (fm) {
    for (const line of fm.block.split(/\r?\n/)) {
      if (!/^(name|description):/.test(line)) lines.push(line);
    }
  }
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

/**
 * Write each skill under `sources` (directories of skills) into `target`.
 * Returns the skill names written.
 */
export function syncClaudeSkills(sources, target) {
  mkdirSync(target, { recursive: true });
  const manifestPath = join(target, MANIFEST);
  if (existsSync(manifestPath)) {
    try {
      for (const name of JSON.parse(readFileSync(manifestPath, "utf-8")).skills ?? []) {
        if (typeof name === "string" && name && !name.includes("/") && !name.includes("..")) {
          rmSync(join(target, name), { recursive: true, force: true });
        }
      }
    } catch {
      // An unreadable manifest only means stale copies may linger.
    }
  }

  const written = [];
  for (const from of sources) {
    if (!existsSync(from)) continue;
    for (const entry of readdirSync(from)) {
      const path = join(from, entry);
      if (statSync(path).isDirectory()) {
        if (!existsSync(join(path, "SKILL.md"))) continue;
        cpSync(path, join(target, entry), { recursive: true });
        written.push(entry);
      } else if (extname(entry) === ".md") {
        const stem = basename(entry, ".md");
        mkdirSync(join(target, stem), { recursive: true });
        writeFileSync(join(target, stem, "SKILL.md"), skillText(stem, readFileSync(path, "utf-8")));
        written.push(stem);
      }
    }
  }

  writeFileSync(
    manifestPath,
    JSON.stringify({ $comment: "Written by tools/compose.mjs. These skill directories are regenerated; do not edit them.", skills: written }, null, 2) + "\n",
  );
  return written;
}
