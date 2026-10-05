// ---------------------------------------------------------------------------
// Channel sources and source pins (ADR-0035)
// ---------------------------------------------------------------------------
// Shared material — a poem's text, illustrations, recital take, word timing —
// is made once and used by several series. It lives in a channel source,
// library/<channel>/sources/<name>/, or in another episode of the channel.
// It is never copied: an episode PINS it, recording an inventory of its files.
//
// The inventory keeps hash, size and mtime per file. The hash is the truth;
// size and mtime only spare re-hashing on a poll: verifyPin stats every file
// and hashes only those whose size or mtime moved. A file touched but not
// edited is unchanged.
//
// An episode's runtime state is never part of a source: journal/, attempts/,
// reviews/, output/, and any name starting with "." or "_".
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schemas/v1alpha1/source-pin.schema.json" with { type: "json" };
import { jsonPath } from "./edit-timeline.mjs";
import { episodePath, sourcePath } from "./layout.mjs";

/** Where an episode keeps its pins, relative to the episode directory. */
export const PINS_DIR = "source/pins";

/** Runtime state of an episode, never inventoried when the source is an episode. */
const EPISODE_STATE = new Set(["journal", "attempts", "reviews", "output"]);

let compiled = null;

function schemaValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(schema);
    compiled = ajv.getSchema(`${schema.$id}#/$defs/SourcePin`);
  }
  return compiled;
}

/**
 * Validate a SourcePin's shape.
 * @returns {{code: string, message: string, path: string}[]}
 */
export function validateSourcePin(doc) {
  const validate = schemaValidator();
  if (validate(doc)) return [];
  return validate.errors.map((e) => ({ code: "schema", message: `${e.instancePath || "/"} ${e.message}`, path: jsonPath(e.instancePath) }));
}

/** The directory a pin's source lives in. */
export function sourceDir(root, channel, source) {
  return source.kind === "channel-source"
    ? sourcePath(root, channel, source.name)
    : episodePath(root, channel, source.series, source.episode);
}

/** sha256 of a file, as a ContentHash. */
export async function hashFile(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

const toPosix = (p) => p.split(sep).join("/");
const hidden = (name) => name.startsWith(".") || name.startsWith("_");

/**
 * The files of a source, source-relative POSIX path → { hash, size, mtimeMs },
 * sorted by path. `paths` restricts it to those files or directories.
 * A symlink is an error: a pin never points outside its source.
 */
export async function inventory(dir, paths, { hash = hashFile } = {}) {
  const files = {};
  const visit = async (abs, top) => {
    const info = await lstat(abs);
    if (info.isSymbolicLink()) throw new Error(`${toPosix(relative(dir, abs))} is a symlink: a source cannot point outside itself`);
    if (info.isDirectory()) {
      for (const name of (await readdir(abs)).sort()) {
        if (hidden(name) || (top && EPISODE_STATE.has(name))) continue;
        await visit(join(abs, name), false);
      }
    } else if (info.isFile()) {
      files[toPosix(relative(dir, abs))] = { hash: await hash(abs), size: info.size, mtimeMs: info.mtimeMs };
    }
  };
  if (paths && paths.length > 0) {
    for (const p of [...paths].sort()) await visit(join(dir, p), false);
  } else {
    await visit(dir, true);
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Every file path a pin's scope covers now, without hashing anything. */
async function currentPaths(dir, paths) {
  const found = new Map();
  const visit = async (abs, top) => {
    let info;
    try {
      info = await lstat(abs);
    } catch {
      return;
    }
    if (info.isDirectory()) {
      for (const name of await readdir(abs)) {
        if (hidden(name) || (top && EPISODE_STATE.has(name))) continue;
        await visit(join(abs, name), false);
      }
    } else if (info.isFile() || info.isSymbolicLink()) {
      found.set(toPosix(relative(dir, abs)), info);
    }
  };
  if (paths && paths.length > 0) for (const p of paths) await visit(join(dir, p), false);
  else await visit(dir, true);
  return found;
}

/**
 * Compare a pin's inventory with its source as it is now.
 * Files whose size and mtime match are not read.
 * @returns {Promise<{changed: {path: string, change: "modified" | "added" | "removed"}[]}>}
 */
export async function verifyPin(pin, dir, { hash = hashFile } = {}) {
  const now = await currentPaths(dir, pin.paths);
  const changed = [];
  for (const [path, entry] of Object.entries(pin.files)) {
    const info = now.get(path);
    if (!info) {
      changed.push({ path, change: "removed" });
    } else if (info.isSymbolicLink()) {
      changed.push({ path, change: "modified" });
    } else if (info.size !== entry.size || info.mtimeMs !== entry.mtimeMs) {
      if ((await hash(join(dir, path))) !== entry.hash) changed.push({ path, change: "modified" });
    }
  }
  for (const path of now.keys()) {
    if (!Object.hasOwn(pin.files, path)) changed.push({ path, change: "added" });
  }
  changed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { changed };
}

/** "a (modified), b (added)", at most `limit` of them. */
export function describeChanges(changed, limit = 5) {
  const shown = changed.slice(0, limit).map((c) => `${c.path} (${c.change})`).join(", ");
  return changed.length > limit ? `${shown} and ${changed.length - limit} more` : shown;
}
