// A polite client for public collections: it says who it is (Wikimedia
// requires a contact in the User-Agent), spaces its requests per host, retries
// what a server says to retry (429, 502, 503, 504) waiting what it asks, up to
// 30 s, and caches JSON answers for a day so the same search costs nothing.

import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Agent, fetch as undiciFetch } from "undici";
import { ArchiveError } from "./errors.js";
import type { Http } from "./types.js";
import { safeUrl } from "./providers/stock-common.js";

const publicUrl = (url: string) => { const u = new URL(url); return `${u.origin}${u.pathname}`; };

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
  /** Cancel requests and streamed downloads for this operation. */
  signal?: AbortSignal;
}

const RETRY = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const MAX_WAIT_MS = 30_000;
const DAY = 24 * 3600 * 1000;
// ccMixter echoes JSON in X-JSON; Node's default header limit rejects normal search pages.
// Bound the exception to 1 MiB and reuse a short-lived connection pool.
const archiveDispatcher = new Agent({ maxHeaderSize: 1024 * 1024, keepAliveTimeout: 1000, keepAliveMaxTimeout: 1000 });

export interface DownloadResult {
  sha256: string;
  bytes: number;
  mime: string;
}

export interface ArchiveHttp extends Http {
  download(url: string, file: string, options?: { headers?: Record<string, string>; maxBytes?: number; allowedHosts?: string[] }): Promise<DownloadResult>;
}

export function createHttp(options: HttpOptions): ArchiveHttp {
  const doFetch = options.fetch ?? ((url: string, init?: RequestInit) => undiciFetch(url, {
    method: init?.method, headers: init?.headers as Record<string, string> | undefined,
    body: init?.body as never, signal: init?.signal, redirect: init?.redirect, dispatcher: archiveDispatcher,
  }) as unknown as Promise<Response>);
  const sleep = options.sleep ?? ((ms: number) => delay(ms, undefined, { signal: options.signal }));
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

  /**
   * The response, its headers within `timeoutMs`. Its body is the caller's to
   * read; `abort` stops it (a download aborts when bytes stop coming).
   */
  async function request(url: string, headers: Record<string, string> = {}, allowedHosts?: string[], method: "GET" | "POST" = "GET", body?: string): Promise<{ response: Response; abort: () => void }> {
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      await turn(url);
      options.signal?.throwIfAborted();
      let response: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`no answer from ${new URL(url).host} within ${timeoutMs} ms`)), timeoutMs);
      try {
        let target = url;
        for (let redirects = 0; ; redirects++) {
          if (allowedHosts && !safeUrl(target, allowedHosts)) throw new ArchiveError("http", "Download URL outside provider CDN allowlist");
          response = await doFetch(target, { method, body, headers: { "User-Agent": options.userAgent, ...headers }, signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal, redirect: allowedHosts ? "manual" : "follow" });
          if (!allowedHosts || ![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get("location");
          await response.body?.cancel().catch(() => undefined);
          if (!location || redirects >= 5) throw new ArchiveError("http", "Invalid or excessive download redirects");
          target = new URL(location, target).href;
        }
      } catch (error) {
        clearTimeout(timer);
        options.signal?.throwIfAborted();
        if (error instanceof ArchiveError) throw error;
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ArchiveError("http", `${new URL(url).host}: request failed`);
      }
      clearTimeout(timer);
      if (response.ok) return { response, abort: () => controller.abort(new Error(`${new URL(url).host} stopped sending for ${timeoutMs} ms`)) };
      if (RETRY.has(response.status) && attempt < MAX_RETRIES) {
        const wait = retryAfter(response.headers.get("retry-after"), now()) ?? 1000 * 2 ** attempt;
        if (wait <= MAX_WAIT_MS) {
          await response.body?.cancel().catch(() => undefined);
          await sleep(wait);
          continue;
        }
      }
      await response.body?.cancel().catch(() => undefined);
      throw new ArchiveError(response.status === 404 ? "not-found" : "http", `${new URL(url).host} answered ${response.status} for ${publicUrl(url)}`);
    }
  }

  const cacheFile = (url: string, headers?: Record<string, string>, body?: unknown) => options.cacheDir && join(options.cacheDir,
    `${createHash("sha256").update(JSON.stringify([url, Object.entries(headers ?? {}).sort(), body ?? null])).digest("hex")}.json`);

  return {
    userAgent: options.userAgent,
    async json(url, { headers, cache = true, method = "GET", body } = {}) {
      options.signal?.throwIfAborted();
      const file = cache ? cacheFile(url, headers, body) : undefined;
      if (file) {
        try {
          const hit = JSON.parse(readFileSync(file, "utf-8")) as { at: number; body: unknown };
          if (now() - hit.at < ttl) return hit.body;
        } catch { /* a miss */ }
      }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const { response, abort } = await request(url, { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}), ...headers }, undefined, method, payload);
      const timer = setTimeout(abort, timeoutMs);
      const text = await response.text().finally(() => clearTimeout(timer));
      let parsed: unknown;
      try {
        // Some APIs echo their request (including keys). Never persist or return those secrets as provenance.
        const secrets = [...new URL(url).searchParams].filter(([name]) => /^(key|api_key|client_id|token|access_token)$/i.test(name)).map(([, value]) => value);
        for (const [name, value] of Object.entries(headers ?? {})) if (name.toLowerCase() === "authorization") secrets.push(value.replace(/^(Bearer|Client-ID)\s+/i, ""));
        let clean = text;
        for (const secret of secrets.filter((s) => s.length >= 6)) clean = clean.split(secret).join("[redacted]").split(encodeURIComponent(secret)).join("[redacted]");
        parsed = JSON.parse(clean);
      } catch {
        throw new ArchiveError("bad-response", `${new URL(url).host} did not answer JSON for ${publicUrl(url)}`);
      }
      if (file) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ at: now(), body: parsed }));
      }
      return parsed;
    },
    async notify(url, { method, headers }) {
      options.signal?.throwIfAborted();
      await turn(url);
      options.signal?.throwIfAborted();
      const response = await doFetch(url, { method, headers: { "User-Agent": options.userAgent, ...headers }, redirect: "error", signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) })
        .catch(() => { throw new ArchiveError("http", `Download accounting failed: ${new URL(url).host}`); });
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) throw new ArchiveError("http", `Download accounting failed: ${new URL(url).host} answered ${response.status}`);
    },
    async download(url, file, { headers, maxBytes = 2 * 1024 ** 3, allowedHosts } = {}) {
      const { response, abort } = await request(url, headers, allowedHosts);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new ArchiveError("too-large", `${url} is ${declared} bytes, more than ${maxBytes}`);
      }
      if (!response.body) throw new ArchiveError("bad-response", `${url} sent no body`);
      mkdirSync(dirname(file), { recursive: true });
      const partial = `${file}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.part`;
      const hash = createHash("sha256");
      let bytes = 0;
      // No limit on the whole download, only on silence: a long video arrives as long as bytes keep coming.
      const source = Readable.fromWeb(response.body as never);
      const stall = () => {
        abort();
        source.destroy(new ArchiveError("http", `${new URL(url).host} stopped sending for ${timeoutMs} ms`));
      };
      let idle = setTimeout(stall, timeoutMs);
      const counted = source.map((chunk: Buffer) => {
        clearTimeout(idle);
        idle = setTimeout(stall, timeoutMs);
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
        if (error instanceof ArchiveError) throw error;
        throw new ArchiveError("http", `${new URL(url).host}: ${(error as Error).message}`);
      } finally {
        clearTimeout(idle);
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
