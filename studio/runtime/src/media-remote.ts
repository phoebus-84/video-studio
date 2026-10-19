// Content-addressed channel media. No lock rewrites, approvals, remote deletion or local overwrites.
import { createHash, randomUUID } from "node:crypto";
import {
  constants, createReadStream, createWriteStream, existsSync, linkSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, posix, relative, sep } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { checkMedia, MEDIA_EXTENSIONS, MEDIA_LOCK, readMediaLock, type MediaEntry } from "./channel-repo.js";
import { s3MediaStore, type MediaObjectStore } from "./media-s3.js";

export const MEDIA_REMOTE = "media.remote.json";
export const MEDIA_TIERS = ["paid", "approved", "archive", "masters", "derived", "deliveries", "other"] as const;
export type MediaTier = typeof MEDIA_TIERS[number];
const DEFAULT_KEEP: MediaTier[] = ["paid", "approved", "archive", "masters", "other"];
export interface MediaRemote {
  apiVersion: "studio.video/v1alpha1";
  kind: "MediaRemote";
  url: string;
  endpoint?: string;
  region: string;
  keep: MediaTier[];
  /** First matching path prefix wins; a prefix is a whole file or directory, not a glob. */
  rules: { prefix: string; tier: MediaTier }[];
  forcePathStyle?: boolean;
  checksum?: boolean;
}
const isTier = (s: unknown): s is MediaTier => typeof s === "string" && (MEDIA_TIERS as readonly string[]).includes(s);
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const below = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
const unsafeCharacters = (value: string) => /[\\:]/.test(value) || [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** Validate before joining: locks are shared, untrusted inputs now that they can cause writes. */
function safeKey(key: string, media = true): void {
  if (!key || unsafeCharacters(key) || key.split("/").some((p) => !p || p === "." || p === ".." || [".git", ".cache", "node_modules"].includes(p.toLowerCase()))) {
    throw new Error(`Unsafe media path: ${JSON.stringify(key)}`);
  }
  if (media && !MEDIA_EXTENSIONS.includes(extname(key).toLowerCase())) throw new Error(`Not a media path: ${key}`);
}

/**
 * HTTP is allowed on loopback and on private IP literals (RFC 1918, CGNAT 100.64/10, IPv6 ULA): a server
 * reached through a VPN such as WireGuard or Tailscale. SigV4 never sends the secret and every download is
 * hash-checked; what HTTP leaves exposed on that network is the media itself. Hostnames are never trusted
 * this way: what they resolve to can change.
 */
function plainHttpHost(host: string): boolean {
  if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return true;
  if (/^\[f[cd][0-9a-f]{2}:[0-9a-f:]*\]$/i.test(host)) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  if (!ip || ip.some((n) => n > 255)) return false;
  const [a = 0, b = 0] = ip;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function readMediaRemote(channelDir: string): MediaRemote {
  const raw: unknown = JSON.parse(readFileSync(join(channelDir, MEDIA_REMOTE), "utf8"));
  const fields = ["apiVersion", "kind", "url", "endpoint", "region", "keep", "rules", "forcePathStyle", "checksum"];
  if (!record(raw) || Object.keys(raw).some((key) => !fields.includes(key))) {
    throw new Error(`${MEDIA_REMOTE}: unknown fields (credentials belong in the environment or AWS profile)`);
  }
  if (raw.apiVersion !== "studio.video/v1alpha1" || raw.kind !== "MediaRemote" || typeof raw.url !== "string" || typeof raw.region !== "string" || !raw.region.trim()) {
    throw new Error(`${MEDIA_REMOTE}: expected studio.video/v1alpha1 MediaRemote with url and region`);
  }
  // Validate the raw path too: URL parsing would silently normalize '..'.
  if (!/^s3:\/\/[a-z0-9][a-z0-9.-]*(?:\/[A-Za-z0-9._/-]*)?$/.test(raw.url)) throw new Error("Media remote URL must be s3://bucket/prefix without credentials, queries or escapes");
  const prefix = raw.url.replace(/^s3:\/\/[^/]+\/?/, "").replace(/\/$/, "");
  if (prefix) safeKey(prefix, false);
  if (raw.endpoint !== undefined) {
    if (typeof raw.endpoint !== "string") throw new Error("Invalid media endpoint");
    const url = new URL(raw.endpoint);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || (url.protocol === "http:" && plainHttpHost(url.hostname)))) {
      throw new Error("Media endpoint must be an HTTPS origin (HTTP allowed only on loopback or a private IP address), without credentials");
    }
  }
  const keep = raw.keep ?? DEFAULT_KEEP;
  if (!Array.isArray(keep) || !keep.every(isTier)) throw new Error(`Invalid keep tiers; expected ${MEDIA_TIERS.join(", ")}`);
  const rules = raw.rules ?? [];
  if (!Array.isArray(rules)) throw new Error("Media rules must be an array");
  for (const rule of rules) {
    if (!record(rule) || Object.keys(rule).some((k) => !["prefix", "tier"].includes(k)) || typeof rule.prefix !== "string" || !isTier(rule.tier)) throw new Error("Each media rule needs a prefix and tier");
    safeKey(rule.prefix, false);
  }
  for (const key of ["checksum", "forcePathStyle"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") throw new Error(`${key} must be boolean`);
  }
  return { ...raw, keep, rules } as unknown as MediaRemote;
}

/** Classification is policy, not proof of a paid generation or a signed approval. Unknown means keep. */
export function mediaTier(path: string, remote: MediaRemote): MediaTier {
  for (const rule of remote.rules) if (below(path, rule.prefix)) return rule.tier;
  // Only the cheap, recognisable delivery names are excluded implicitly. Receipts and
  // derivability are not inferred from a filename: classify derived directories explicitly.
  if (/(^|\/)output\/(?:final-|long-)[^/]+$/.test(path)) return "deliveries";
  return "other";
}

export function mediaEpisodePrefix(root: string, episode: string): string {
  const parts = episode.split("/");
  if (parts.length !== 2) throw new Error("episode must be <series>/<episode>");
  for (const part of parts) safeKey(part, false);
  return relative(root, episodePath(dirname(root), root.split(sep).pop()!, parts[0]!, parts[1]!)).split(sep).join("/");
}

export function mediaObjectKey(remote: MediaRemote, hash: string): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid media hash: ${hash}`);
  const prefix = new URL(remote.url).pathname.replace(/^\/+|\/+$/g, "");
  return `${prefix ? `${prefix}/` : ""}sha256/${hash.slice(7, 9)}/${hash.slice(7)}`;
}

/** Refuse symlinked parents, including links staying inside the channel. Never follow a leaf link. */
function localPath(root: string, key: string): string {
  safeKey(key);
  let dir = root;
  for (const part of key.split("/").slice(0, -1)) {
    dir = join(dir, part);
    let stat;
    try { stat = lstatSync(dir); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe media parent: ${key}`);
  }
  return join(root, key);
}
function statAt(file: string) {
  try { return lstatSync(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function linkTarget(key: string, target: string): string {
  if (!target || target.startsWith("/") || posix.normalize(target) !== target || unsafeCharacters(target)) throw new Error(`Unsafe symlink: ${key}`);
  const result = posix.normalize(posix.join(posix.dirname(key), target));
  safeKey(result);
  return result;
}
const fileStream = (file: string) => createReadStream(file, { fd: openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW) });

class MediaMismatchError extends Error {}

async function verifyStream(stream: Readable, entry: { hash: string; size: number }, output?: string, signal?: AbortSignal): Promise<void> {
  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, done) {
    size += chunk.length;
    if (size > entry.size) { done(new MediaMismatchError("Media size exceeds the lock")); return; }
    hash.update(chunk);
    done(null, output ? chunk : undefined);
  } });
  if (output) await pipeline(stream, meter, createWriteStream(output, { flags: "wx", mode: 0o600 }), { signal });
  else await pipeline(stream, meter, { signal });
  if (size !== entry.size || `sha256:${hash.digest("hex")}` !== entry.hash) throw new MediaMismatchError("Media hash or size does not match the lock");
}

async function pool<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) await run(items[cursor++]!);
  }));
}

export interface MediaTransferOptions {
  episode?: string;
  tiers?: string[];
  dryRun?: boolean;
  concurrency?: number;
  signal?: AbortSignal;
  /** Injection for tests; normal calls use S3. */
  store?: MediaObjectStore;
}
export interface MediaTransferReport {
  ok: boolean;
  dryRun: boolean;
  transferred: string[];
  bytes: number;
  planned: string[];
  plannedBytes: number;
  present: string[];
  missing: string[];
  changed: string[];
  ambiguous: string[];
  errors: { path: string; error: string }[];
  excluded: Record<MediaTier, { files: number; bytes: number }>;
}

function prepare(channelDir: string, options: MediaTransferOptions) {
  const root = realpathSync(channelDir);
  const remote = readMediaRemote(root);
  if (!existsSync(join(root, MEDIA_LOCK))) throw new Error(`${MEDIA_LOCK} is missing: make it with vpr channel media`);
  const lock = readMediaLock(root);
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("concurrency must be an integer between 1 and 16");
  const tiers = options.tiers ?? remote.keep;
  if (!tiers.every((t) => t === "all" || isTier(t)) || (tiers.includes("all") && tiers.length !== 1)) throw new Error(`Invalid tiers; use all or ${MEDIA_TIERS.join(", ")}`);
  let scope: string | undefined;
  if (options.episode !== undefined) {
    scope = mediaEpisodePrefix(root, options.episode);
  }
  for (const [key, entries] of lock) {
    safeKey(key);
    for (const entry of entries) {
      if ("link" in entry) linkTarget(key, entry.link);
      else {
        mediaObjectKey(remote, entry.hash);
        if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 5 * 1024 ** 4) throw new Error(`Invalid media size: ${key}`);
      }
    }
  }
  const selected = new Set([...lock.keys()].filter((key) => !scope || below(key, scope)));
  if (scope && !selected.size) throw new Error(`No locked media for episode: ${options.episode}`);
  // An episode's relative links can name channel/series sources. Include their locked targets,
  // never arbitrary neighbouring episodes or an unlisted external file.
  const visit = (key: string, seen: Set<string>) => {
    if (seen.has(key)) throw new Error(`Cyclic media symlink: ${key}`);
    const entries = lock.get(key);
    if (!entries) throw new Error(`Symlink target is not in ${MEDIA_LOCK}: ${key}`);
    selected.add(key);
    for (const entry of entries) if ("link" in entry) visit(linkTarget(key, entry.link), new Set([...seen, key]));
  };
  for (const key of selected) visit(key, new Set());
  // Validate all selected parent directories before making any network request or write.
  for (const key of selected) localPath(root, key);
  const store = options.store ?? s3MediaStore({
    bucket: new URL(remote.url).hostname, endpoint: remote.endpoint, region: remote.region,
    forcePathStyle: remote.forcePathStyle, checksum: remote.checksum, signal: options.signal,
  });
  const heads = new Map<string, Promise<{ size: number } | undefined>>();
  const head = (entry: { hash: string; size: number }) => {
    const key = mediaObjectKey(remote, entry.hash);
    if (!heads.has(key)) heads.set(key, store.head(key));
    return heads.get(key)!.then((found) => {
      if (found && found.size !== entry.size) throw new Error(`Remote object size disagrees with the lock: ${entry.hash}`);
      return found;
    });
  };
  return { root, remote, lock, selected, scope, tiers, concurrency, store, head };
}

export async function transferMedia(channelDir: string, direction: "push" | "pull", options: MediaTransferOptions = {}): Promise<MediaTransferReport> {
  const p = prepare(channelDir, options);
  const report: MediaTransferReport = {
    ok: true, dryRun: !!options.dryRun, transferred: [], bytes: 0, planned: [], plannedBytes: 0,
    present: [], missing: [], changed: [], ambiguous: [], errors: [],
    excluded: Object.fromEntries(MEDIA_TIERS.map((tier) => [tier, { files: 0, bytes: 0 }])) as MediaTransferReport["excluded"],
  };
  const rows: { key: string; entry: MediaEntry }[] = [];
  for (const key of p.selected) {
    const entries = p.lock.get(key)!;
    if (entries.length !== 1) { report.ambiguous.push(key); continue; }
    const entry = entries[0]!;
    const tier = mediaTier(key, p.remote);
    if (!p.tiers.includes("all") && !p.tiers.includes(tier)) {
      report.excluded[tier].files++;
      report.excluded[tier].bytes += "size" in entry ? entry.size : 0;
    } else rows.push({ key, entry });
  }
  // Deduplicate uploads, including concurrent workers. Failed promises stay failed for this run.
  const uploads = new Map<string, Promise<boolean>>();
  const plannedHashes = new Set<string>();
  const run = async ({ key, entry }: typeof rows[number]) => {
    try {
      options.signal?.throwIfAborted();
      const file = localPath(p.root, key);
      const stat = statAt(file);
      if ("link" in entry) {
        if (stat) {
          (stat.isSymbolicLink() && readlinkSync(file) === entry.link ? report.present : report.changed).push(key);
          return;
        }
        if (direction === "push") { report.present.push(key); return; } // Links are already backed up in git.
        // A link is restored only if the entire target chain matches or would be restored.
        let target = linkTarget(key, entry.link);
        while (true) {
          const entries = p.lock.get(target)!;
          if (entries.length !== 1) throw new Error(`Ambiguous symlink target: ${target}`);
          const expected = entries[0]!;
          const path = localPath(p.root, target);
          const actual = statAt(path);
          if ("link" in expected) {
            if (actual && (!actual.isSymbolicLink() || readlinkSync(path) !== expected.link)) throw new Error(`Changed symlink target: ${target}`);
            if (!actual && !(options.dryRun && report.planned.includes(target))) throw new Error(`Missing symlink target: ${target}`);
            target = linkTarget(target, expected.link);
          } else {
            if (actual?.isFile()) await verifyStream(fileStream(path), expected, undefined, options.signal);
            else if (!options.dryRun || !report.planned.includes(target)) throw new Error(`Missing symlink target: ${target}`);
            break;
          }
        }
        if (options.dryRun) report.planned.push(key);
        else {
          mkdirSync(dirname(file), { recursive: true });
          localPath(p.root, key);
          symlinkSync(entry.link, file); // Exclusive creation, including dangling existing links.
          report.transferred.push(key);
        }
        return;
      }
      if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink()) { report.changed.push(key); return; }
        try { await verifyStream(fileStream(file), entry, undefined, options.signal); }
        catch (error) {
          if (!(error instanceof MediaMismatchError)) throw error;
          report.changed.push(key);
          return;
        }
        if (direction === "pull") { report.present.push(key); return; }
      }
      const found = await p.head(entry);
      if (direction === "push") {
        if (found) { report.present.push(key); return; }
        if (!stat) { report.missing.push(key); return; }
        if (options.dryRun) {
          report.planned.push(key);
          if (!plannedHashes.has(entry.hash)) { report.plannedBytes += entry.size; plannedHashes.add(entry.hash); }
          return;
        }
        if (!uploads.has(entry.hash)) uploads.set(entry.hash, (async () => {
          const tempDir = mkdtempSync(join(tmpdir(), "vpr-media-push-"));
          try {
            const snapshot = join(tempDir, "snapshot");
            // Upload exactly the verified bytes, even if the source changes during the request.
            await verifyStream(fileStream(localPath(p.root, key)), entry, snapshot, options.signal);
            const created = await p.store.put(mediaObjectKey(p.remote, entry.hash), snapshot, entry);
            if (created) report.bytes += entry.size;
            else if ((await p.store.head(mediaObjectKey(p.remote, entry.hash)))?.size !== entry.size) throw new Error("Concurrent upload is unavailable or has the wrong size");
            return created;
          } finally { rmSync(tempDir, { recursive: true, force: true }); }
        })());
        (await uploads.get(entry.hash) ? report.transferred : report.present).push(key);
      } else {
        if (!found) { report.missing.push(key); return; }
        if (options.dryRun) { report.planned.push(key); report.plannedBytes += entry.size; return; }
        mkdirSync(dirname(file), { recursive: true });
        localPath(p.root, key);
        const temp = join(dirname(file), `.media-pull-${randomUUID()}.tmp`);
        try {
          await verifyStream(await p.store.get(mediaObjectKey(p.remote, entry.hash)), entry, temp, options.signal);
          localPath(p.root, key);
          // rename() would overwrite a file created while GET was in flight. link+unlink
          // publishes a complete verified file atomically, but never replaces any leaf.
          linkSync(temp, file);
          report.transferred.push(key);
          report.bytes += entry.size;
        } finally { rmSync(temp, { force: true }); }
      }
    } catch (error) { report.errors.push({ path: key, error: errorText(error) }); }
  };
  try {
    await pool(rows.filter(({ entry }) => "hash" in entry), p.concurrency, run);
    // Topological order for link chains, after their actual bytes have arrived.
    const links = rows.filter(({ entry }) => "link" in entry);
    const depth = (key: string): number => {
      const entries = p.lock.get(key)!;
      return entries.length === 1 && "link" in entries[0]! ? 1 + depth(linkTarget(key, entries[0]!.link)) : 0;
    };
    for (const row of links.sort((a, b) => depth(a.key) - depth(b.key))) await run(row);
  } finally { if (!options.store) p.store.close?.(); }
  for (const key of ["transferred", "planned", "present", "missing", "changed", "ambiguous"] as const) report[key].sort();
  report.errors.sort((a, b) => a.path.localeCompare(b.path));
  report.ok = !report.missing.length && !report.changed.length && !report.ambiguous.length && !report.errors.length;
  return report;
}

/** Remote availability does not mean local readiness. Keep check's nonzero exit until bytes match. */
export async function checkRemoteMedia(channelDir: string, options: MediaTransferOptions & { verify?: boolean } = {}) {
  const p = prepare(channelDir, { ...options, tiers: ["all"] });
  try {
    const local = checkMedia(p.root, { verify: options.verify, pathPrefix: p.scope, paths: p.selected });
    const remote: string[] = [];
    const missing: string[] = [];
    const ambiguous = [...p.selected].filter((key) => p.lock.get(key)!.length !== 1).sort();
    const errors: { path: string; error: string }[] = [];
    await pool(local.missing, p.concurrency, async (key) => {
      try {
        let target = key;
        while (true) {
          const entries = p.lock.get(target)!;
          if (entries.length !== 1) { missing.push(key); return; }
          const entry = entries[0]!;
          if ("link" in entry) {
            const file = localPath(p.root, target);
            const actual = statAt(file);
            if (actual && (!actual.isSymbolicLink() || readlinkSync(file) !== entry.link)) throw new Error(`Changed symlink target: ${target}`);
            target = linkTarget(target, entry.link);
            continue;
          }
          // A link can be reconstructed from a matching local target even without a remote object.
          const file = localPath(p.root, target);
          if (target !== key && statAt(file)?.isFile()) {
            await verifyStream(fileStream(file), entry);
            remote.push(key);
          } else (await p.head(entry) ? remote : missing).push(key);
          return;
        }
      } catch (error) { errors.push({ path: key, error: errorText(error) }); }
    });
    return { ...local, ok: local.ok && !ambiguous.length && !errors.length, missing: missing.sort(), remote: remote.sort(), ambiguous, errors };
  } finally { if (!options.store) p.store.close?.(); }
}
