// ---------------------------------------------------------------------------
// A channel's media in a shared store, by hash (ADR-0045's storage issue)
// ---------------------------------------------------------------------------
// media.lock.jsonl names every heavy file by sha256; the store keeps the bytes
// under that hash, so a file is uploaded once whatever its path or channel,
// and what a collaborator lacks after a pull is fetched by the name the lock
// gives it. The store is any S3-compatible bucket (a Garage at home, MinIO,
// S3 itself), spoken to with three signed requests: HEAD, PUT and GET.
//
// It is configured from the environment only (ADR-0030):
//   AVG_MEDIA_STORE             endpoints, comma-separated, tried in order:
//                               the LAN one first, the VPN one for away
//   AVG_MEDIA_STORE_BUCKET      the bucket
//   AVG_MEDIA_STORE_PREFIX      where in it (default "video-studio/media/")
//   AVG_MEDIA_STORE_REGION      the signing region (default "us-east-1")
//   AVG_MEDIA_STORE_ACCESS_KEY_ID, AVG_MEDIA_STORE_SECRET_ACCESS_KEY
// ---------------------------------------------------------------------------

import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { channelMedia, MEDIA_LOCK, readMediaLock } from "./channel-repo.js";

export interface StoreConfig {
  endpoints: string[];
  bucket: string;
  prefix: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** The store the environment names, or why there is none. */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): StoreConfig {
  const endpoints = (env.AVG_MEDIA_STORE ?? "").split(",").map((e) => e.trim().replace(/\/+$/, "")).filter(Boolean);
  const missing = [
    !endpoints.length && "AVG_MEDIA_STORE",
    !env.AVG_MEDIA_STORE_BUCKET && "AVG_MEDIA_STORE_BUCKET",
    !env.AVG_MEDIA_STORE_ACCESS_KEY_ID && "AVG_MEDIA_STORE_ACCESS_KEY_ID",
    !env.AVG_MEDIA_STORE_SECRET_ACCESS_KEY && "AVG_MEDIA_STORE_SECRET_ACCESS_KEY",
  ].filter(Boolean);
  if (missing.length) throw new Error(`no media store: set ${missing.join(", ")}`);
  for (const e of endpoints) if (!/^https?:\/\/[^/]+$/.test(e)) throw new Error(`AVG_MEDIA_STORE: "${e}" is not http(s)://host[:port]`);
  const prefix = env.AVG_MEDIA_STORE_PREFIX ?? "video-studio/media/";
  return {
    endpoints,
    bucket: env.AVG_MEDIA_STORE_BUCKET!,
    prefix: prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix,
    region: env.AVG_MEDIA_STORE_REGION || "us-east-1",
    accessKeyId: env.AVG_MEDIA_STORE_ACCESS_KEY_ID!,
    secretAccessKey: env.AVG_MEDIA_STORE_SECRET_ACCESS_KEY!,
  };
}

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
/** RFC 3986, as SigV4 wants it: every byte but the unreserved ones escaped. */
const uriEncode = (s: string, slash = true) =>
  [...Buffer.from(s, "utf-8")].map((b) => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9\-._~]/.test(c) || (!slash && c === "/") ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");

/**
 * AWS Signature V4 headers for one request. The payload is not signed
 * (UNSIGNED-PAYLOAD) unless its hash is given: a video is streamed, never read
 * twice to be hashed for the signature; the store's hash check is ours anyway.
 */
export function signRequest(
  config: Pick<StoreConfig, "region" | "accessKeyId" | "secretAccessKey">,
  req: { method: string; host: string; path: string; query?: Record<string, string>; headers?: Record<string, string>; payloadHash?: string; now?: Date },
): Record<string, string> {
  const stamp = (req.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {
    ...req.headers,
    host: req.host,
    "x-amz-content-sha256": req.payloadHash ?? "UNSIGNED-PAYLOAD",
    "x-amz-date": stamp,
  };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const query = Object.entries(req.query ?? {}).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).sort().join("&");
  const canonical = [req.method, uriEncode(req.path, false), query, ...names.map((n) => `${n}:${lower[n]}`), "", names.join(";"), headers["x-amz-content-sha256"]].join("\n");
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

/** A signed request to one endpoint; the body, if any, is piped in with its length. */
function send(
  config: StoreConfig,
  endpoint: string,
  method: string,
  key: string,
  options: { body?: () => NodeJS.ReadableStream; length?: number; timeoutMs?: number } = {},
): Promise<IncomingMessage> {
  const url = new URL(endpoint);
  const path = `/${config.bucket}${key ? `/${key}` : ""}`;
  const headers = signRequest(config, { method, host: url.host, path, headers: options.length !== undefined ? { "content-length": String(options.length) } : {} });
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request({ method, host: url.hostname, port: url.port, path: uriEncode(path, false), headers }, resolve);
    req.setTimeout(options.timeoutMs ?? 60_000, () => req.destroy(new Error(`${endpoint} did not answer in time`)));
    req.on("error", reject);
    if (options.body) options.body().on("error", (e) => req.destroy(e)).pipe(req);
    else req.end();
  });
}

const drain = async (res: IncomingMessage) => {
  let text = "";
  for await (const chunk of res) text += chunk;
  return text;
};
const failure = async (what: string, res: IncomingMessage) => {
  const body = await drain(res);
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  return new Error(`${what}: HTTP ${res.statusCode}${code ? ` ${code}` : ""}`);
};

/** The first endpoint that answers, and that accepts our key for the bucket. */
export async function connect(config: StoreConfig): Promise<MediaStore> {
  const tried: string[] = [];
  for (const endpoint of config.endpoints) {
    let res: IncomingMessage;
    try {
      res = await send(config, endpoint, "HEAD", "", { timeoutMs: 3_000 });
    } catch (error) {
      tried.push(`${endpoint} (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    res.resume();
    if (res.statusCode === 200) return new MediaStore(config, endpoint);
    throw new Error(`${endpoint} answers, but the bucket "${config.bucket}" refuses this key: HTTP ${res.statusCode}`);
  }
  throw new Error(`no media store answers: ${tried.join("; ")}`);
}

export class MediaStore {
  constructor(readonly config: StoreConfig, readonly endpoint: string) {}

  /** `sha256:<hex>` → `<prefix>sha256/<2 hex>/<hex>`: fanned out, one object a hash. */
  keyOf(hash: string): string {
    const [algo, hex] = hash.split(":");
    if (algo !== "sha256" || !hex || !/^[0-9a-f]{64}$/.test(hex)) throw new Error(`not a sha256 hash: ${hash}`);
    return `${this.config.prefix}sha256/${hex.slice(0, 2)}/${hex}`;
  }

  /** The size the store holds for a hash, or null. */
  async has(hash: string): Promise<number | null> {
    const res = await send(this.config, this.endpoint, "HEAD", this.keyOf(hash));
    res.resume();
    if (res.statusCode === 404) return null;
    if (res.statusCode !== 200) throw new Error(`HEAD ${hash}: HTTP ${res.statusCode}`);
    return Number(res.headers["content-length"] ?? -1);
  }

  async put(hash: string, file: string): Promise<void> {
    const size = statSync(file).size;
    const res = await send(this.config, this.endpoint, "PUT", this.keyOf(hash), { body: () => createReadStream(file), length: size, timeoutMs: 600_000 });
    if (res.statusCode !== 200) throw await failure(`PUT ${hash}`, res);
    res.resume();
  }

  /**
   * The bytes of a hash into `file`, through a temporary file renamed only
   * when their hash and size are the ones asked for: a broken download never
   * passes for the media.
   */
  async get(hash: string, size: number, file: string): Promise<void> {
    const res = await send(this.config, this.endpoint, "GET", this.keyOf(hash), { timeoutMs: 600_000 });
    if (res.statusCode !== 200) throw await failure(`GET ${hash}`, res);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const digest = createHash("sha256");
    let got = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        digest.update(chunk);
        got += chunk.length;
        done(null, chunk);
      },
    });
    try {
      await pipeline(res, tap, createWriteStream(tmp));
      const actual = `sha256:${digest.digest("hex")}`;
      if (actual !== hash || got !== size) throw new Error(`GET ${hash}: the store gave ${got} bytes hashing ${actual}`);
      renameSync(tmp, file);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }
}

export interface MediaSync {
  endpoint: string;
  /** Hashes sent, or fetched, by this call. */
  moved: { path: string; hash: string; size: number }[];
  /** Already where they should be. */
  present: number;
  /** What could not be moved, and why. */
  skipped: { path: string; reason: string }[];
  failed: { path: string; error: string }[];
}

/** Run `work` over `items`, `limit` at a time. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

/**
 * Send the store every file of this machine that the lock names with these
 * very bytes, once a hash. A file not yet named, or changed since, is left:
 * `vpr channel media` names it first, so the lock and the store agree.
 * `maxBytes` leaves bigger files here: a pull then says they are not stored.
 */
export async function pushMedia(
  channelDir: string,
  store: MediaStore,
  options: { concurrency?: number; maxBytes?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<MediaSync> {
  const lock = readMediaLock(channelDir);
  const out: MediaSync = { endpoint: store.endpoint, moved: [], present: 0, skipped: [], failed: [] };
  const todo = new Map<string, { path: string; file: string; size: number }>();
  const media = channelMedia(channelDir);
  for (const [path, file] of media.files) {
    const named = lock.get(path);
    const entry = media.entry(path, file);
    if (!("hash" in entry)) continue;
    if (!named) out.skipped.push({ path, reason: `not named in ${MEDIA_LOCK}: run vpr channel media first` });
    else if (!named.some((e) => "hash" in e && e.hash === entry.hash)) out.skipped.push({ path, reason: `not the bytes ${MEDIA_LOCK} names: run vpr channel media first` });
    // A render of an hour is made again from its master; the store keeps what it is made from.
    else if (options.maxBytes !== undefined && entry.size > options.maxBytes) out.skipped.push({ path, reason: `${(entry.size / 1e6).toFixed(0)} MB, over the ${(options.maxBytes / 1e6).toFixed(0)} MB asked` });
    else if (!todo.has(entry.hash)) todo.set(entry.hash, { path, file, size: entry.size });
  }
  media.save();
  const items = [...todo];
  let done = 0;
  await pool(items, options.concurrency ?? 4, async ([hash, { path, file, size }]) => {
    try {
      if ((await store.has(hash)) === size) out.present++;
      else {
        await store.put(hash, file);
        out.moved.push({ path, hash, size });
      }
    } catch (error) {
      out.failed.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
    options.onProgress?.(++done, items.length);
  });
  return out;
}

/**
 * Fetch from the store every file the lock names that this machine lacks.
 * A file already here is never overwritten, even when it differs: that is
 * `--check`'s "changed", for a person to settle. A symlink is not media.
 */
export async function pullMedia(channelDir: string, store: MediaStore, options: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<MediaSync> {
  const lock = readMediaLock(channelDir);
  const onDisk = channelMedia(channelDir).files;
  const out: MediaSync = { endpoint: store.endpoint, moved: [], present: 0, skipped: [], failed: [] };
  const items: { path: string; entries: { hash: string; size: number }[] }[] = [];
  for (const [path, entries] of lock) {
    if (onDisk.has(path)) {
      out.present++;
      continue;
    }
    const files = entries.filter((e): e is { hash: string; size: number } => "hash" in e);
    if (!files.length) out.skipped.push({ path, reason: "a symlink: make it by hand" });
    else items.push({ path, entries: files });
  }
  let done = 0;
  await pool(items, options.concurrency ?? 4, async ({ path, entries }) => {
    // Two entries after a union merge: either is the file, the first the store holds wins.
    let error = "";
    for (const entry of entries) {
      try {
        if ((await store.has(entry.hash)) === null) {
          error ||= "not in the store: whoever has it pushes it";
          continue;
        }
        await store.get(entry.hash, entry.size, join(channelDir, ...path.split("/")));
        out.moved.push({ path, ...entry });
        error = "";
        break;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    if (error) out.failed.push({ path, error });
    options.onProgress?.(++done, items.length);
  });
  return out;
}
