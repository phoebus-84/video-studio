// ---------------------------------------------------------------------------
// A channel as its own git repository (avg-d1x, phase 5)
// ---------------------------------------------------------------------------
// A channel's code, releases and data — specs, templates, kits, themes, takes'
// records, timings, timelines, journals, reviews — are text, small, and
// versioned in the channel's own repository, which several people can share.
// Its heavy media are not: pictures, audio and video stay out of git, and
// media.lock.json names each one by its path, sha256 and size, so a
// collaborator who pulls knows exactly which files they lack and can fetch
// them by hash (the storage that serves them is a later issue).
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

export const MEDIA_LOCK = "media.lock.json";

/** What counts as heavy media: kept out of git, named in the lock. */
export const MEDIA_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".psd",
  ".mp4", ".mov", ".mkv", ".webm",
  ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg",
  ".woff", ".woff2", ".ttf", ".otf",
  ".blend",
];

/** Folders never versioned nor locked: what a machine makes for itself. */
const LOCAL_DIRS = new Set([".git", ".cache", "node_modules"]);

const GITIGNORE = `# A channel's repository (vpr channel init): its text is versioned here; its
# heavy media are not. media.lock.json names each of them by hash and size:
# \`vpr channel media <channel>\` updates it, \`--check\` says what you lack.

# Heavy media
${MEDIA_EXTENSIONS.map((ext) => `*${ext}`).join("\n")}

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
# Sealed bundles are built, never edited by hand.
*.cjs -diff linguist-generated
`;

export interface MediaEntry {
  hash: string;
  size: number;
}

export interface MediaLock {
  apiVersion: "studio.video/v1alpha1";
  kind: "MediaLock";
  files: Record<string, MediaEntry>;
}

const isMedia = (file: string) => MEDIA_EXTENSIONS.includes(extname(file).toLowerCase());
const posix = (path: string) => path.split(sep).join("/");

/** Every heavy media file of the channel, relative and sorted, outside the local folders. */
function mediaFiles(channelDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!LOCAL_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && isMedia(entry.name)) {
        out.push(posix(relative(channelDir, join(dir, entry.name))));
      }
    }
  };
  walk(channelDir);
  return out.sort();
}

/**
 * A file's hash, from this machine's cache when its size and mtime have not
 * moved: hashing 1.7 GB on every call would be the slow part. The cache is
 * local (.cache/), never versioned: mtimes mean nothing on another machine.
 */
function hasher(channelDir: string) {
  const cacheFile = join(channelDir, ".cache", "media-hashes.json");
  let cache: Record<string, { size: number; mtimeMs: number; hash: string }> = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, "utf-8"));
  } catch { /* none yet */ }
  const next: typeof cache = {};
  return {
    entry(path: string): MediaEntry {
      const stat = statSync(join(channelDir, path));
      const hit = cache[path];
      const hash = hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs
        ? hit.hash
        : `sha256:${createHash("sha256").update(readFileSync(join(channelDir, path))).digest("hex")}`;
      next[path] = { size: stat.size, mtimeMs: stat.mtimeMs, hash };
      return { hash, size: stat.size };
    },
    save() {
      mkdirSync(join(channelDir, ".cache"), { recursive: true });
      writeFileSync(`${cacheFile}.tmp`, JSON.stringify(next));
      renameSync(`${cacheFile}.tmp`, cacheFile);
    },
  };
}

/** Write media.lock.json naming every heavy file as it is now. Returns how many it names. */
export function writeMediaLock(channelDir: string): { files: number; bytes: number } {
  const hash = hasher(channelDir);
  const files: Record<string, MediaEntry> = {};
  let bytes = 0;
  for (const path of mediaFiles(channelDir)) {
    files[path] = hash.entry(path);
    bytes += files[path]!.size;
  }
  hash.save();
  const lock: MediaLock = { apiVersion: "studio.video/v1alpha1", kind: "MediaLock", files };
  const target = join(channelDir, MEDIA_LOCK);
  writeFileSync(`${target}.tmp`, `${JSON.stringify(lock, null, 2)}\n`);
  renameSync(`${target}.tmp`, target);
  return { files: Object.keys(files).length, bytes };
}

export interface MediaCheck {
  ok: boolean;
  /** Named in the lock, not on this machine: to fetch. */
  missing: string[];
  /** On this machine, but not the bytes the lock names. */
  changed: string[];
  /** On this machine, not yet named: `vpr channel media` adds them. */
  unlisted: string[];
}

/** The channel's heavy media against its lock. Reads only (but this machine's hash cache). */
export function checkMedia(channelDir: string): MediaCheck {
  let lock: MediaLock;
  try {
    lock = JSON.parse(readFileSync(join(channelDir, MEDIA_LOCK), "utf-8"));
  } catch {
    throw new Error(`${MEDIA_LOCK} is missing or not JSON: make it with vpr channel media`);
  }
  const hash = hasher(channelDir);
  const onDisk = new Set(mediaFiles(channelDir));
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [path, entry] of Object.entries(lock.files ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!onDisk.has(path)) missing.push(path);
    else if (hash.entry(path).hash !== entry.hash) changed.push(path);
    onDisk.delete(path);
  }
  hash.save();
  const unlisted = [...onDisk].sort();
  return { ok: missing.length === 0 && changed.length === 0 && unlisted.length === 0, missing, changed, unlisted };
}

/**
 * Make `channelDir` a git repository: .gitignore and .gitattributes as above
 * (a repository or a file already there is kept as it is), media.lock.json
 * written, and with `commit` a first commit of all of it.
 */
export function initChannelRepo(
  channelDir: string,
  options: { commit?: boolean; author?: { name: string; email: string } } = {},
): { created: string[]; kept: string[]; media: { files: number; bytes: number }; commit: string | null } {
  if (!existsSync(channelDir) || !statSync(channelDir).isDirectory()) throw new Error(`${channelDir} is not a channel folder`);
  const git = (...args: string[]) => execFileSync("git", ["-C", channelDir, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  const created: string[] = [];
  const kept: string[] = [];
  if (existsSync(join(channelDir, ".git"))) kept.push(".git");
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
  let commit: string | null = null;
  if (options.commit) {
    git("add", "-A");
    const name = channelDir.split(sep).filter(Boolean).pop();
    const identity = options.author ? ["-c", `user.name=${options.author.name}`, "-c", `user.email=${options.author.email}`] : [];
    execFileSync("git", ["-C", channelDir, ...identity, "commit", "-q", "-m", `The ${name} channel as a repository: its media named in ${MEDIA_LOCK}`], { stdio: ["ignore", "pipe", "pipe"] });
    commit = git("rev-parse", "--short", "HEAD").trim();
  }
  return { created, kept, media, commit };
}
