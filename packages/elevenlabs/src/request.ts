// One ElevenLabs request at a time per process, with CreativeStudio's rules
// (UP-39): at most two retries, only for 429 and 503 — answers that say the
// request was not processed — waiting Retry-After (seconds or a date; or 2 s,
// then 4 s), and none when it asks for more than 30 s; never a retry for auth
// or quota, nor for another 5xx, after which the work may have been done and
// billed; a connection lost after the request left is `uncertain` and is not
// retried either. The key never appears in an error.

import { ElevenLabsError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const MAX_RETRIES = 2;
const MAX_WAIT_MS = 30_000;

export interface RequestOptions {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
  /** Tests: how to wait between retries. */
  sleep?: (ms: number) => Promise<void>;
}

let queue: Promise<unknown> = Promise.resolve();

/** Run `task` after every earlier ElevenLabs request of this process has finished. */
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Errors raised before any byte left: nothing was sent, so nothing was processed. */
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);

function causeCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code;
}

async function describe(response: Response, apiKey: string): Promise<{ message: string; status?: string }> {
  let detail: unknown;
  try {
    detail = (await response.json() as { detail?: unknown }).detail;
  } catch {
    detail = undefined;
  }
  const status = typeof detail === "object" && detail !== null ? String((detail as { status?: unknown }).status ?? "") : "";
  const message = typeof detail === "string"
    ? detail
    : typeof detail === "object" && detail !== null && typeof (detail as { message?: unknown }).message === "string"
      ? (detail as { message: string }).message
      : `HTTP ${response.status}`;
  return { message: message.split(apiKey).join("[key]"), status };
}

/** How long Retry-After asks to wait, in ms (seconds or an HTTP date); the back-off when it says nothing. */
function waitFor(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 2000 * 2 ** attempt;
}

/** POST `path` with `body` and return the parsed JSON answer. */
export function postForm(path: string, body: () => FormData, options: RequestOptions): Promise<unknown> {
  const sleep = options.sleep ?? defaultSleep;
  const url = `${options.baseUrl ?? DEFAULT_BASE_URL}${path}`;
  return oneAtATime(async () => {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, { method: "POST", headers: { "xi-api-key": options.apiKey }, body: body(), signal: options.signal ?? null });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const code = causeCode(error);
        if (code && NOT_SENT.has(code)) throw new ElevenLabsError("unreachable", `ElevenLabs could not be reached (${code}); nothing was sent`);
        throw new ElevenLabsError("uncertain", `the connection to ElevenLabs broke after the request was sent (${code ?? "no answer"}); it may have been processed`);
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new ElevenLabsError("uncertain", "ElevenLabs answered, but not with JSON; the request may have been processed");
        }
      }
      const { message, status } = await describe(response, options.apiKey);
      if (status === "quota_exceeded" || response.status === 402) throw new ElevenLabsError("quota", `ElevenLabs quota: ${message}`, response.status);
      if (response.status === 401 || response.status === 403) throw new ElevenLabsError("auth", `ElevenLabs refused the key: ${message}`, response.status);
      const retryable = response.status === 429 || response.status === 503;
      const wait = waitFor(response, attempt);
      if (retryable && attempt < MAX_RETRIES && wait <= MAX_WAIT_MS) {
        await sleep(wait);
        continue;
      }
      if (response.status === 429) {
        const later = wait > MAX_WAIT_MS ? ` (retry after ${Math.round(wait / 1000)} s)` : "";
        throw new ElevenLabsError("rate-limited", `ElevenLabs is rate limiting: ${message}${later}`, 429);
      }
      if (response.status >= 500) throw new ElevenLabsError("server", `ElevenLabs failed: ${message}`, response.status);
      throw new ElevenLabsError("bad-request", `ElevenLabs refused the request: ${message}`, response.status);
    }
  });
}
