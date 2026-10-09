// A polite client for public collections: it says who it is (Wikimedia
// requires a contact in the User-Agent), spaces its requests per host, retries
// what a server says to retry (429, 502, 503, 504) waiting what it asks, up to
// 30 s, and caches JSON answers for a day so the same search costs nothing.

import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ArchiveError } from "./errors.js";
import type { Http } from "./types.js";

export interface HttpOptions {
  userAgent: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** JSON answers are cached here for `cacheTtlMs`. None: no cache. */
  cacheDir?: string;
  cacheTtlMs?: number;
  now?: () => number;
  /** Least time between two requests to one host. Default 250 ms. */
  minIntervalMs?: number;
  timeoutMs?: number;
}

const RETRY = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const MAX_WAIT_MS = 30_000;
const DAY = 24 * 3600 * 1000;

export interface DownloadResult {
  sha256: string;
  bytes: number;
  mime: string;
}

export interface ArchiveHttp extends Http {
  download(url: string, file: string, options?: { headers?: Record<string, string>; maxBytes?: number }): Promise<DownloadResult>;
}

export function createHttp(options: HttpOptions): ArchiveHttp {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const minInterval = options.minIntervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const ttl = options.cacheTtlMs ?? DAY;
  const lastByHost = new Map<string, Promise<number>>();

  /** Wait this host's turn: requests to one host leave at least `minInterval` apart. */
  async function turn(url: string): Promise<void> {
    const host = new URL(url).host;
    const previous = lastByHost.get(host) ?? Promise.resolve(Number.NEGATIVE_INFINITY);
    const mine = previous.then(async (last) => {
      const wait = last + minInterval - now();
      if (wait > 0) await sleep(wait);
      return now();
    });
    lastByHost.set(host, mine.catch(() => now()));
    await mine;
  }

  async function request(url: string, headers: Record<string, string> = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await turn(url);
      let response: Response;
      try {
        response = await doFetch(url, { headers: { "User-Agent": options.userAgent, ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ArchiveError("http", `${new URL(url).host}: ${(error as Error).message}`);
      }
      if (response.ok) return response;
      if (RETRY.has(response.status) && attempt < MAX_RETRIES) {
        const wait = retryAfter(response.headers.get("retry-after"), now()) ?? 1000 * 2 ** attempt;
        if (wait <= MAX_WAIT_MS) {
          await response.body?.cancel().catch(() => undefined);
          await sleep(wait);
          continue;
        }
      }
      await response.body?.cancel().catch(() => undefined);
      throw new ArchiveError(response.status === 404 ? "not-found" : "http", `${new URL(url).host} answered ${response.status} for ${url}`);
    }
  }

  const cacheFile = (url: string) => options.cacheDir && join(options.cacheDir, `${createHash("sha256").update(url).digest("hex")}.json`);

  return {
    userAgent: options.userAgent,
    async json(url, { headers, cache = true } = {}) {
      const file = cache ? cacheFile(url) : undefined;
      if (file) {
        try {
          const hit = JSON.parse(readFileSync(file, "utf-8")) as { at: number; body: unknown };
          if (now() - hit.at < ttl) return hit.body;
        } catch { /* a miss */ }
      }
      const response = await request(url, { Accept: "application/json", ...headers });
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ArchiveError("bad-response", `${new URL(url).host} did not answer JSON for ${url}`);
      }
      if (file) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ at: now(), body }));
      }
      return body;
    },
    async download(url, file, { headers, maxBytes = 2 * 1024 ** 3 } = {}) {
      const response = await request(url, headers);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new ArchiveError("too-large", `${url} is ${declared} bytes, more than ${maxBytes}`);
      }
      if (!response.body) throw new ArchiveError("bad-response", `${url} sent no body`);
      mkdirSync(dirname(file), { recursive: true });
      const partial = `${file}.part`;
      const hash = createHash("sha256");
      let bytes = 0;
      const counted = Readable.fromWeb(response.body as never).map((chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new ArchiveError("too-large", `${url} is more than ${maxBytes} bytes`);
        hash.update(chunk);
        return chunk;
      });
      try {
        await pipeline(counted, createWriteStream(partial));
        renameSync(partial, file);
      } catch (error) {
        rmSync(partial, { force: true });
        throw error;
      }
      return { sha256: `sha256:${hash.digest("hex")}`, bytes, mime: (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() };
    },
  };
}

/** Retry-After in milliseconds: seconds, or an HTTP date. */
export function retryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
