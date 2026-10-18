// ---------------------------------------------------------------------------
// A channel as its own git repository (avg-d1x, phase 5)
// ---------------------------------------------------------------------------
// A channel's code, releases and data — specs, templates, kits, themes, takes'
// records, timings, timelines, journals, reviews — are text, small, and
// versioned in the channel's own repository, which several people can share.
// Its heavy media are not: pictures, audio and video stay out of git, and
// media.lock.jsonl names each one by its path, sha256 and size, one line a
// file, so a collaborator who pulls knows exactly which files they lack and
// can fetch them by hash (the storage that serves them is a later issue).
//
// The lock is shared work, so it never forgets: a file the lock names stays
// named on a machine that has not fetched it, until someone prunes it on
// purpose. Its lines merge by union; a file two people named differently
// shows twice until the next `vpr channel media` settles it from the bytes.
// ---------------------------------------------------------------------------

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

export const MEDIA_LOCK = "media.lock.jsonl";

/** What counts as heavy media: kept out of git, named in the lock. */
export const MEDIA_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".psd",
  ".mp4", ".mov", ".mkv", ".webm",
  ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg",
  ".woff", ".woff2", ".ttf", ".otf",
  ".blend", ".zip",
];

/** Folders never versioned nor locked: what a machine makes for itself. */
const LOCAL_DIRS = new Set([".git", ".cache", "node_modules"]);

/** `*.[pP][nN][gG]`: git's ignore rules are case-sensitive on Linux. */
const anyCase = (ext: string) => `*${[...ext].map((c) => (/[a-z]/.test(c) ? `[${c}${c.toUpperCase()}]` : c)).join("")}`;

const GITIGNORE = `# A channel's repository (vpr channel init): its text is versioned here; its
# heavy media are not. ${MEDIA_LOCK} names each of them by hash and size:
# \`vpr channel media <channel>\` updates it, \`--check\` says what you lack.

# Heavy media, in any case
${MEDIA_EXTENSIONS.map(anyCase).join("\n")}

# What a machine makes for itself
.cache/
node_modules/
*.tmp
# A rebuild's backup of the timeline it replaced: git keeps the history now.
*.bak.json
.DS_Store
`;

const GITATTRIBUTES = `# Stage journals are append-only: two people adding events merge by union.
**/journal/*.jsonl merge=union
# One line a media file: two people naming new media merge by union too.
${MEDIA_LOCK} merge=union
# Sealed bundles are built, never edited by hand.
*.cjs -diff linguist-generated
`;

/** A file by its bytes, or a symlink by where it points (never followed). */
export type MediaEntry = { hash: string; size: number } | { link: string };

const HEADER = { apiVersion: "studio.video/v1alpha1", kind: "MediaLock" } as const;

const isMedia = (file: string) => MEDIA_EXTENSIONS.includes(extname(file).toLowerCase());
/** Relative, `/`-separated and NFC: macOS and Linux spell é the same way in the lock. */
const keyOf = (channelDir: string, file: string) => relative(channelDir, file).split(sep).join("/").normalize("NFC");
const sameEntry = (a: MediaEntry, b: MediaEntry) =>
  "link" in a ? "link" in b && a.link === b.link : "hash" in b && a.hash === b.hash && a.size === b.size;

/** Every heavy media file of the channel, by its key, outside the local folders. Symlinks are not followed. */
function mediaFiles(channelDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!LOCAL_DIRS.has(entry.name)) walk(file);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && isMedia(entry.name)) {
        out.set(keyOf(channelDir, file), file);
      }
    }
  };
  walk(channelDir);
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** sha256 of a file read in chunks: a video of any size, never whole in memory. */
function hashFile(file: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1 << 20);
  const fd = openSync(file, "r");
  try {
    for (let read; (read = readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * A file's entry, its hash from this machine's cache when its size and mtime
 * have not moved: hashing 1.7 GB on every call would be the slow part. The
 * cache is local (.cache/), never versioned: mtimes mean nothing elsewhere.
 * `verify` hashes every byte again.
 */
function hasher(channelDir: string, options: { verify?: boolean } = {}) {
  const cacheFile = join(channelDir, ".cache", "media-hashes.json");
  let cache: Record<string, { size: number; mtimeMs: number; hash: string }> = {};
  if (!options.verify) {
    try {
      cache = JSON.parse(readFileSync(cacheFile, "utf-8"));
    } catch { /* none yet */ }
  }
  const next: typeof cache = {};
  return {
    entry(key: string, file: string): MediaEntry {
      const link = lstatSync(file);
      if (link.isSymbolicLink()) return { link: readlinkSync(file) };
      const hit = cache[key];
      const hash = hit && hit.size === link.size && hit.mtimeMs === link.mtimeMs ? hit.hash : hashFile(file);
      next[key] = { size: link.size, mtimeMs: link.mtimeMs, hash };
      return { hash, size: link.size };
    },
    save() {
      mkdirSync(join(channelDir, ".cache"), { recursive: true });
      writeFileSync(`${cacheFile}.tmp`, JSON.stringify(next));
      renameSync(`${cacheFile}.tmp`, cacheFile);
    },
  };
}

/**
 * The lock's entries by key. A key may hold two entries after a union merge
 * of two people's lines; identical lines count once. A missing lock is empty.
 */
export function readMediaLock(channelDir: string): Map<string, MediaEntry[]> {
  const file = join(channelDir, MEDIA_LOCK);
  const out = new Map<string, MediaEntry[]>();
  if (!existsSync(file)) return out;
  for (const [index, line] of readFileSync(file, "utf-8").split("\n").entries()) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`${MEDIA_LOCK} line ${index + 1} is not JSON (a merge conflict left in it?)`);
    }
    if (row.kind === HEADER.kind) continue;
    const key = typeof row.path === "string" ? row.path.normalize("NFC") : "";
    const entry: MediaEntry | null = typeof row.link === "string" ? { link: row.link }
      : typeof row.hash === "string" && typeof row.size === "number" ? { hash: row.hash, size: row.size } : null;
    if (!key || !entry) throw new Error(`${MEDIA_LOCK} line ${index + 1} names no path with a hash and size, or a link`);
    const entries = out.get(key) ?? [];
    if (!entries.some((e) => sameEntry(e, entry))) entries.push(entry);
    out.set(key, entries);
  }
  return out;
}

/**
 * Name every heavy file on this machine in the lock, as it is now, keeping
 * what the lock names that this machine lacks: another person's media, not
 * fetched here. `prune` forgets those instead: files deleted on purpose.
 */
export function writeMediaLock(
  channelDir: string,
  options: { prune?: boolean; verify?: boolean } = {},
): { files: number; bytes: number; absent: number; pruned: number } {
  const before = readMediaLock(channelDir);
  const hash = hasher(channelDir, options);
  const lines = new Map<string, MediaEntry[]>();
  let bytes = 0;
  for (const [key, file] of mediaFiles(channelDir)) {
    const entry = hash.entry(key, file);
    lines.set(key, [entry]);
    if ("size" in entry) bytes += entry.size;
  }
  hash.save();
  let absent = 0;
  let pruned = 0;
  for (const [key, entries] of before) {
    if (lines.has(key)) continue;
    if (options.prune) pruned++;
    else {
      lines.set(key, entries);
      absent++;
    }
  }
  const rows = [...lines].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([path, entries]) => entries.map((entry) => JSON.stringify({ path, ...entry })));
  const target = join(channelDir, MEDIA_LOCK);
  writeFileSync(`${target}.tmp`, [JSON.stringify(HEADER), ...rows, ""].join("\n"));
  renameSync(`${target}.tmp`, target);
  return { files: lines.size, bytes, absent, pruned };
}

export interface MediaCheck {
  ok: boolean;
  /** Named in the lock, not on this machine: to fetch. */
  missing: string[];
  /** On this machine, but not the bytes (or the link) the lock names. */
  changed: string[];
  /** On this machine, not yet named: `vpr channel media` adds them. */
  unlisted: string[];
}

/** The channel's heavy media against its lock. Reads only; `verify` ignores the hash cache. */
export function checkMedia(channelDir: string, options: { verify?: boolean; pathPrefix?: string; paths?: ReadonlySet<string> } = {}): MediaCheck {
  if (!existsSync(join(channelDir, MEDIA_LOCK))) throw new Error(`${MEDIA_LOCK} is missing: make it with vpr channel media`);
  const lock = readMediaLock(channelDir);
  const hash = hasher(channelDir, options);
  const inScope = (key: string) => !options.pathPrefix || key === options.pathPrefix || key.startsWith(`${options.pathPrefix}/`) || options.paths?.has(key);
  const onDisk = new Map([...mediaFiles(channelDir)].filter(([key]) => inScope(key)));
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [key, entries] of [...lock].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!inScope(key)) continue;
    const file = onDisk.get(key);
    if (!file) missing.push(key);
    else {
      const entry = hash.entry(key, file);
      if (!entries.some((e) => sameEntry(e, entry))) changed.push(key);
    }
    onDisk.delete(key);
  }
  const unlisted = [...onDisk.keys()];
  return { ok: missing.length === 0 && changed.length === 0 && unlisted.length === 0, missing, changed, unlisted };
}

export interface ChannelRepo {
  created: string[];
  kept: string[];
  media: { files: number; bytes: number; absent: number; pruned: number };
  /** Media on this machine that git would commit: a .gitignore kept from before does not leave them out. */
  notIgnored: string[];
  /** What the kept .gitattributes lacks for merging by union. */
  warnings: string[];
  commit: string | null;
}

/**
 * Make `channelDir` a git repository: .gitignore and .gitattributes as above
 * (a repository or a file already there is kept as it is), the lock written,
 * and with `commit` a commit — of everything in a repository it just made, of
 * only its own files in one it found — or none when nothing changed.
 */
export function initChannelRepo(
  channelDir: string,
  options: { commit?: boolean; author?: { name: string; email: string } } = {},
): ChannelRepo {
  if (!existsSync(channelDir) || !statSync(channelDir).isDirectory()) throw new Error(`${channelDir} is not a channel folder`);
  const git = (...args: string[]) => execFileSync("git", ["-C", channelDir, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  const created: string[] = [];
  const kept: string[] = [];
  const found = existsSync(join(channelDir, ".git"));
  if (found) kept.push(".git");
  else git("init", "-q");
  for (const [name, content] of [[".gitignore", GITIGNORE], [".gitattributes", GITATTRIBUTES]] as const) {
    if (existsSync(join(channelDir, name))) kept.push(name);
    else {
      writeFileSync(join(channelDir, name), content);
      created.push(name);
    }
  }
  const media = writeMediaLock(channelDir);
  created.push(MEDIA_LOCK);

  const files = [...mediaFiles(channelDir).keys()];
  const ignored = new Set(
    (spawnSync("git", ["-C", channelDir, "check-ignore", "-z", "--stdin"], { input: files.join("\0"), encoding: "utf-8" }).stdout ?? "")
      .split("\0").filter(Boolean).map((p) => p.normalize("NFC")),
  );
  const notIgnored = files.filter((f) => !ignored.has(f));
  const warnings: string[] = [];
  const merge = (path: string) => git("check-attr", "merge", "--", path).trim().endsWith(": union");
  if (!merge(MEDIA_LOCK)) warnings.push(`.gitattributes does not merge ${MEDIA_LOCK} by union: add "${MEDIA_LOCK} merge=union"`);
  if (!merge("series/x/episodes/y/journal/events.jsonl")) warnings.push('.gitattributes does not merge stage journals by union: add "**/journal/*.jsonl merge=union"');

  let commit: string | null = null;
  if (options.commit) {
    if (found) git("add", "--", ...created);
    else git("add", "-A");
    const staged = spawnSync("git", ["-C", channelDir, "diff", "--cached", "--quiet"]).status !== 0;
    if (staged) {
      const name = channelDir.split(sep).filter(Boolean).pop();
      const identity = options.author ? ["-c", `user.name=${options.author.name}`, "-c", `user.email=${options.author.email}`] : [];
      execFileSync("git", ["-C", channelDir, ...identity, "commit", "-q", "-m", `The ${name} channel as a repository: its media named in ${MEDIA_LOCK}`], { stdio: ["ignore", "pipe", "pipe"] });
      commit = git("rev-parse", "--short", "HEAD").trim();
    }
  }
  return { created, kept, media, notIgnored, warnings, commit };
}
