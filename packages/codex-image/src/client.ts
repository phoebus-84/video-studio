// ── Client ──────────────────────────────────────────────────────────────────
//
// Two transports, one result type.
//
//   subscription — the Codex backend, billed against a ChatGPT Plus/Pro plan.
//                  No API key, no per-image charge, undocumented protocol.
//   api          — the documented Images API, billed against API credits.
//
// They are not interchangeable to the person paying, so the caller chooses and
// this module never silently falls back from one to the other: quietly moving
// a batch of images onto metered credits is not a decision to make on someone
// else's behalf.
// ---------------------------------------------------------------------------

import { CodexImageError } from "./errors.js";
import {
  CODEX_RESPONSES_URL,
  buildHeaders,
  buildRequestBody,
  extractAccountId,
  parseSseStream,
} from "./protocol.js";
import type {
  ClientOptions,
  GenerateRequest,
  GeneratedImage,
  OutputFormat,
  Transport,
} from "./types.js";

/** Routing model for the subscription transport. */
const DEFAULT_ROUTING_MODEL = "gpt-6.1-sol";
/** Image model for the API transport. */
const DEFAULT_API_MODEL = "gpt-image-2";
const DEFAULT_API_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_RETRIES = 2;

const MIME: Record<OutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export class CodexImageClient {
  readonly #transport: Transport;
  readonly #maxRetries: number;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: ClientOptions) {
    this.#transport = options.transport;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

    if (this.#transport.kind === "subscription" && !this.#transport.token) {
      throw new CodexImageError(
        "NO_CREDENTIAL",
        "The subscription transport needs an OAuth token",
        "In Pi this comes from the openai-codex provider; run /login and pick ChatGPT Plus/Pro.",
      );
    }
    if (this.#transport.kind === "api" && !this.#transport.apiKey) {
      throw new CodexImageError(
        "NO_CREDENTIAL",
        "The API transport needs an API key",
        "Set OPENAI_API_KEY, or use the subscription transport instead.",
      );
    }
  }

  /** Which transport this client speaks, for provenance and logging. */
  get provider(): string {
    return this.#transport.kind === "subscription" ? "openai-codex" : "openai-api";
  }

  /**
   * Generate an image, or edit the supplied ones.
   *
   * Retries only what is worth retrying: a refusal or a bad credential fails
   * on the first attempt, because trying again costs quota and changes
   * nothing.
   */
  async generate(request: GenerateRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    if (!request.prompt.trim()) {
      throw new CodexImageError("PROTOCOL", "A prompt is required");
    }

    const deadline = Date.now() + this.#timeoutMs;
    let lastError: CodexImageError | undefined;

    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      if (signal?.aborted) throw new CodexImageError("ABORTED", "Image generation was cancelled");
      if (Date.now() >= deadline) {
        throw new CodexImageError(
          "ABORTED",
          `Image generation exceeded ${this.#timeoutMs}ms`,
          lastError ? `last failure: ${lastError.message}` : "",
        );
      }

      try {
        return this.#transport.kind === "subscription"
          ? await this.#viaSubscription(request, this.#transport, signal)
          : await this.#viaApi(request, this.#transport, signal);
      } catch (err) {
        const error = asCodexError(err);
        if (!isRetryable(error) || attempt === this.#maxRetries) throw error;
        lastError = error;
        // Exponential with jitter: a quota reset is shared by every client
        // hitting it, and synchronised retries make it worse.
        const backoff = Math.min(2 ** attempt * 1000, 8000);
        await this.#sleep(backoff + Math.floor(Math.random() * 250));
      }
    }

    /* c8 ignore next */
    throw lastError ?? new CodexImageError("PROTOCOL", "Image generation failed without an error");
  }

  // ── Subscription transport ────────────────────────────────────────────────

  async #viaSubscription(
    request: GenerateRequest,
    transport: Extract<Transport, { kind: "subscription" }>,
    signal?: AbortSignal,
  ): Promise<GeneratedImage> {
    const outputFormat = request.outputFormat ?? "png";
    const model = request.model ?? DEFAULT_ROUTING_MODEL;
    const accountId = transport.accountId ?? extractAccountId(transport.token);

    const response = await this.#send(
      transport.baseUrl ?? CODEX_RESPONSES_URL,
      {
        method: "POST",
        headers: buildHeaders(transport.token, accountId),
        body: JSON.stringify(
          buildRequestBody({
            prompt: request.prompt,
            model,
            outputFormat,
            ...(request.inputImages ? { inputImages: request.inputImages } : {}),
            ...(request.cacheKey ? { cacheKey: request.cacheKey } : {}),
          }),
        ),
        ...(signal ? { signal } : {}),
      },
    );

    if (!response.ok) throw await httpError(response);
    if (!response.body) {
      throw new CodexImageError("PROTOCOL", "The backend returned no response stream");
    }

    const parsed = await parseSseStream(response.body, signal);

    if (!parsed.image) {
      // The model answered in prose instead of drawing. Its own words are the
      // most useful thing we can show, so they become the detail.
      throw new CodexImageError(
        "NO_IMAGE",
        "The backend returned no image",
        parsed.text.trim() || "The response contained no image_generation_call.",
      );
    }

    return {
      data: Buffer.from(parsed.image.result, "base64"),
      outputFormat,
      ...(parsed.image.revisedPrompt ? { revisedPrompt: parsed.image.revisedPrompt } : {}),
      provider: "openai-codex",
      // The routing model is what we asked for; the backend renders with its
      // own image model, which it does not name in the response.
      model,
      ...(parsed.responseId ? { requestId: parsed.responseId } : {}),
      ...(parsed.usage ? { usage: parsed.usage } : {}),
    };
  }

  // ── Images API transport ──────────────────────────────────────────────────

  async #viaApi(
    request: GenerateRequest,
    transport: Extract<Transport, { kind: "api" }>,
    signal?: AbortSignal,
  ): Promise<GeneratedImage> {
    const outputFormat = request.outputFormat ?? "png";
    const model = request.model ?? DEFAULT_API_MODEL;
    const base = transport.baseUrl ?? DEFAULT_API_BASE_URL;
    const editing = (request.inputImages?.length ?? 0) > 0;

    const url = `${base}/v1/images/${editing ? "edits" : "generations"}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${transport.apiKey}` };
    let body: string | FormData;

    if (editing) {
      // Edits take multipart, one `image[]` part per reference.
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", request.prompt);
      form.set("output_format", outputFormat);
      if (request.size) form.set("size", request.size);
      if (request.quality) form.set("quality", request.quality);
      for (const [index, image] of (request.inputImages ?? []).entries()) {
        form.append(
          "image[]",
          new Blob([new Uint8Array(image.data)], { type: image.mimeType }),
          `reference-${index}.${image.mimeType.split("/")[1] ?? "png"}`,
        );
      }
      body = form;
    } else {
      headers["content-type"] = "application/json";
      body = JSON.stringify({
        model,
        prompt: request.prompt,
        n: 1,
        output_format: outputFormat,
        ...(request.size ? { size: request.size } : {}),
        ...(request.quality ? { quality: request.quality } : {}),
      });
    }

    const response = await this.#send(url, {
      method: "POST",
      headers,
      body,
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) throw await httpError(response);

    const payload = (await response.json().catch(() => undefined)) as
      | {
          data?: Array<{ b64_json?: string; revised_prompt?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
        }
      | undefined;

    const first = payload?.data?.[0];
    if (!first?.b64_json) {
      throw new CodexImageError(
        "NO_IMAGE",
        "The Images API returned no image data",
        "The response carried no data[0].b64_json.",
      );
    }

    return {
      data: Buffer.from(first.b64_json, "base64"),
      outputFormat,
      ...(first.revised_prompt ? { revisedPrompt: first.revised_prompt } : {}),
      provider: "openai-api",
      model,
      ...(payload?.usage
        ? {
            usage: {
              ...(payload.usage.input_tokens !== undefined ? { inputTokens: payload.usage.input_tokens } : {}),
              ...(payload.usage.output_tokens !== undefined ? { outputTokens: payload.usage.output_tokens } : {}),
              ...(payload.usage.total_tokens !== undefined ? { totalTokens: payload.usage.total_tokens } : {}),
            },
          }
        : {}),
    };
  }

  /** One request, with transport failures mapped onto our error type. */
  async #send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, init);
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
        throw new CodexImageError("ABORTED", "Image generation was cancelled");
      }
      throw new CodexImageError(
        "NETWORK",
        "Could not reach the image backend",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/** Content type for a generated image, e.g. to store beside the artifact. */
export function mimeTypeFor(format: OutputFormat): string {
  return MIME[format];
}

async function httpError(response: Response): Promise<CodexImageError> {
  const text = await response.text().catch(() => "");
  const detail = text.slice(0, 600);

  if (response.status === 401 || response.status === 403) {
    return new CodexImageError(
      "NO_CREDENTIAL",
      "The image backend rejected the credential",
      detail || "Log in again — an OAuth token expires and Pi does not refresh it for us.",
      response.status,
    );
  }
  if (response.status === 429) {
    return new CodexImageError(
      "RATE_LIMIT",
      "The image quota or rate limit is exhausted",
      detail,
      response.status,
    );
  }
  if (response.status === 400 && /moderation|safety|content.policy/i.test(text)) {
    return new CodexImageError("MODERATION", "The prompt was refused by content moderation", detail, 400);
  }
  return new CodexImageError("HTTP", `The image backend returned ${response.status}`, detail, response.status);
}

function asCodexError(err: unknown): CodexImageError {
  if (err instanceof CodexImageError) return err;
  return new CodexImageError("PROTOCOL", err instanceof Error ? err.message : String(err));
}

/**
 * A refusal, a bad credential and a malformed prompt all fail again the same
 * way, and every retry of a moderation refusal still spends quota.
 */
function isRetryable(error: CodexImageError): boolean {
  if (error.code === "NETWORK" || error.code === "RATE_LIMIT") return true;
  if (error.code === "HTTP") return error.status !== undefined && error.status >= 500;
  return false;
}
