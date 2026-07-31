export type AttemptJobPhase = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface DurableAttemptJob {
  job_id: string;
  phase: AttemptJobPhase;
  segment: Record<string, unknown>;
  profile: Record<string, unknown>;
  request_fingerprint: string;
  provider_mode: "live" | "fake";
  attempt_id?: string | null;
  cache_hit: boolean;
  retry_count: number;
  retry_of?: string | null;
  retry_reason?: string | null;
  recovered_after_restart: boolean;
}

export class TtsWorkerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = "TtsWorkerError";
  }
}

export interface QwenTtsClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Abort-aware client for canonical durable segment attempts and narration master jobs. */
export class QwenTtsClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: QwenTtsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}, callerSignal?: AbortSignal): Promise<T> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("TTS worker request timed out")), this.timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeout.signal])
      : timeout.signal;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        const detail = body.detail;
        const first = Array.isArray(detail) ? detail[0] as Record<string, unknown> | undefined : undefined;
        const code = String(body.code ?? first?.type ?? `http_${response.status}`);
        throw new TtsWorkerError(
          String(body.error ?? body.message ?? response.statusText),
          response.status,
          code,
          detail,
        );
      }
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async assertCompatible(signal?: AbortSignal): Promise<string> {
    const openapi = await this.request<{ info?: { version?: string } }>("/openapi.json", {}, signal);
    const version = openapi.info?.version;
    if (!version || !/^0\.1(?:\.|$)/.test(version)) {
      throw new TtsWorkerError(
        `Incompatible Qwen TTS worker API version ${version ?? "missing"}; expected 0.1.x`,
        409,
        "api_version_incompatible",
        { received: version, expected: "0.1.x" },
      );
    }
    return version;
  }

  submitSegment(
    segment: Record<string, unknown>,
    profile: Record<string, unknown>,
    options: { useCache?: boolean; signal?: AbortSignal } = {},
  ): Promise<DurableAttemptJob> {
    return this.request("/attempt-jobs", {
      method: "POST",
      body: JSON.stringify({ segment, profile, use_cache: options.useCache ?? true }),
    }, options.signal);
  }

  getJob(jobId: string, signal?: AbortSignal): Promise<DurableAttemptJob> {
    return this.request(`/attempt-jobs/${encodeURIComponent(jobId)}`, {}, signal);
  }

  execute(jobId: string, signal?: AbortSignal): Promise<DurableAttemptJob> {
    return this.request(`/attempt-jobs/${encodeURIComponent(jobId)}/execute`, { method: "POST" }, signal);
  }

  cancel(jobId: string, signal?: AbortSignal): Promise<DurableAttemptJob> {
    return this.request(`/attempt-jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }, signal);
  }

  getAttempt(jobId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.request(`/attempt-jobs/${encodeURIComponent(jobId)}/attempt`, {}, signal);
  }

  validate(
    jobId: string,
    spokenWordCount: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.request(`/attempt-jobs/${encodeURIComponent(jobId)}/validate`, {
      method: "POST",
      body: JSON.stringify({ spoken_word_count: spokenWordCount }),
    }, signal);
  }

  process(
    jobId: string,
    reportId: string,
    pauseAfterMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.request(`/attempt-jobs/${encodeURIComponent(jobId)}/process`, {
      method: "POST",
      body: JSON.stringify({ report_id: reportId, pause_after_ms: pauseAfterMs }),
    }, signal);
  }

  retry(jobId: string, signal?: AbortSignal): Promise<DurableAttemptJob> {
    return this.request(`/attempt-jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" }, signal);
  }

  retryQuality(jobId: string, reportId: string, signal?: AbortSignal): Promise<DurableAttemptJob> {
    return this.request(`/attempt-jobs/${encodeURIComponent(jobId)}/retry-quality`, {
      method: "POST",
      body: JSON.stringify({ report_id: reportId }),
    }, signal);
  }

  master(
    plan: Record<string, unknown>,
    profile?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.request("/narrations/master", {
      method: "POST",
      body: JSON.stringify({ plan, ...(profile ? { profile } : {}) }),
    }, signal);
  }

  async waitForTerminal(
    jobId: string,
    options: { pollMs?: number; signal?: AbortSignal } = {},
  ): Promise<DurableAttemptJob> {
    const pollMs = options.pollMs ?? 250;
    while (true) {
      if (options.signal?.aborted) throw options.signal.reason;
      const job = await this.getJob(jobId, options.signal);
      if (["completed", "failed", "cancelled"].includes(job.phase)) return job;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, pollMs);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(options.signal?.reason);
        }, { once: true });
      });
    }
  }
}
