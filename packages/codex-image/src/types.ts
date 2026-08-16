// ── Types ───────────────────────────────────────────────────────────────────

/** Output encodings the backend can return. */
export type OutputFormat = "png" | "jpeg" | "webp";

/** An image handed to the model as a reference or an edit target. */
export interface InputImage {
  /** Raw bytes. The caller reads the file; this package does no IO. */
  data: Buffer;
  /** e.g. "image/png". Sent as part of the data URL. */
  mimeType: string;
}

export interface GenerateRequest {
  prompt: string;
  /** Reference images. Present ones turn a generation into an edit. */
  inputImages?: InputImage[];
  outputFormat?: OutputFormat;
  /**
   * Routing model for the subscription transport (the backend still renders
   * with its own image model), or the image model itself for the API
   * transport. Defaults differ per transport, so each one resolves its own.
   */
  model?: string;
  /** Size hint, e.g. "1536x1024". Only the API transport honours it. */
  size?: string;
  /** Quality hint. Only the API transport honours it. */
  quality?: "low" | "medium" | "high" | "auto";
  /**
   * Groups related requests for the backend's prompt cache. Reusing one value
   * across a scene's retries is cheaper than a fresh value each time.
   */
  cacheKey?: string;
}

/** Token usage, when the transport reports it. */
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface GeneratedImage {
  /** Decoded image bytes. */
  data: Buffer;
  outputFormat: OutputFormat;
  /** What the backend says it actually drew, when it says. */
  revisedPrompt?: string;
  /** Which transport and model produced this. Recorded as provenance. */
  provider: string;
  model: string;
  /** The backend's own id for the call, for support and deduplication. */
  requestId?: string;
  usage?: Usage;
}

/**
 * How to reach the backend.
 *
 * `subscription` bills against a ChatGPT Plus/Pro plan through the Codex
 * backend and needs an OAuth token the caller obtained elsewhere. `api` bills
 * against API credits and needs an API key. They are genuinely different
 * products, so the caller picks; this package never guesses.
 */
export type Transport =
  | { kind: "subscription"; token: string; accountId?: string; baseUrl?: string }
  | { kind: "api"; apiKey: string; baseUrl?: string };

export interface ClientOptions {
  transport: Transport;
  /** Retries for transient failures. Default 2 (so three attempts). */
  maxRetries?: number;
  /** Wall-clock budget for one generation, retries included. Default 180s. */
  timeoutMs?: number;
  /** Injected for tests. Real code should leave these alone. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}
