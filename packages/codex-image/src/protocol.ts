// ── Codex Responses protocol ────────────────────────────────────────────────
//
// The subscription transport talks to the same backend the Codex CLI uses. It
// is not a documented public API: it can change without notice, and when it
// does the failure will look like a protocol error rather than an outage.
// Everything shape-dependent is therefore isolated here, so a break is one
// file to read and one file to fix.
//
// The request is an ordinary Responses call whose only tool is the built-in
// `image_generation`; the backend chooses the image model. The reply is an SSE
// stream, and the image arrives base64-encoded on an `image_generation_call`
// output item.
// ---------------------------------------------------------------------------

import { CodexImageError } from "./errors.js";
import type { InputImage, OutputFormat, Usage } from "./types.js";

export const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

/** The claim the ChatGPT account id hides under, inside the OAuth token. */
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";

/**
 * The backend answers a plain Responses request with prose. This tells it the
 * job is to draw, once — without it a request can come back as a description
 * of an image rather than an image.
 */
export const IMAGE_INSTRUCTIONS =
  "You are generating bitmap image assets. For this request, call the image_generation tool exactly once. " +
  "Do not answer with only text unless image generation is unavailable.";

export interface CodexRequestOptions {
  prompt: string;
  model: string;
  outputFormat: OutputFormat;
  inputImages?: InputImage[];
  cacheKey?: string;
}

/** Build the JSON body for one image request. */
export function buildRequestBody(options: CodexRequestOptions): Record<string, unknown> {
  const images = options.inputImages ?? [];

  return {
    model: options.model,
    // Nothing about a generated asset should persist in a chat history we do
    // not control; the artifact belongs in the workspace.
    store: false,
    stream: true,
    ...(options.cacheKey ? { prompt_cache_key: options.cacheKey } : {}),
    instructions: IMAGE_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: options.prompt },
          ...images.map((image) => ({
            type: "input_image",
            image_url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
          })),
        ],
      },
    ],
    tools: [{ type: "image_generation", output_format: options.outputFormat }],
    tool_choice: "auto",
    // One image per request keeps a failure attributable to one prompt.
    parallel_tool_calls: false,
    text: { verbosity: "low" },
  };
}

/** Headers for a subscription-transport request. */
export function buildHeaders(token: string, accountId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "chatgpt-account-id": accountId,
    originator: "pi",
    "OpenAI-Beta": "responses=experimental",
    accept: "text/event-stream",
    "content-type": "application/json",
  };
}

/**
 * Read the ChatGPT account id out of the OAuth token.
 *
 * The backend requires it as a header even though it is already inside the
 * token it is sent with. This only decodes the payload — it does not verify
 * the signature, which is the backend's job, not ours.
 */
export function extractAccountId(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new CodexImageError(
      "BAD_CREDENTIAL",
      "The OpenAI Codex credential is not a JWT",
      "Log in to the openai-codex provider again (`/login` in Pi) and retry.",
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new CodexImageError(
      "BAD_CREDENTIAL",
      "Cannot decode the OpenAI Codex credential",
      err instanceof Error ? err.message : String(err),
    );
  }

  const claims = payload[JWT_AUTH_CLAIM];
  const accountId =
    claims && typeof claims === "object"
      ? (claims as Record<string, unknown>)["chatgpt_account_id"]
      : undefined;

  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new CodexImageError(
      "BAD_CREDENTIAL",
      "The OpenAI Codex credential carries no ChatGPT account id",
      "This usually means the login was for an API key rather than a ChatGPT Plus/Pro plan.",
    );
  }
  return accountId;
}

export interface ParsedResponse {
  /** Base64 image payload, when the model drew one. */
  image?: { result: string; revisedPrompt?: string; status: string };
  /** Any prose the model emitted — the explanation when it refuses to draw. */
  text: string;
  responseId?: string;
  usage?: Usage;
}

/**
 * Fold one decoded SSE event into the accumulating response.
 *
 * Exported for tests: a synthetic event sequence is far cheaper to assert on
 * than a live stream, and every branch here is a failure mode seen in the wild.
 */
export function applyEvent(event: Record<string, unknown>, into: ParsedResponse): void {
  const type = typeof event["type"] === "string" ? (event["type"] as string) : "";

  switch (type) {
    case "error": {
      const message = str(event["message"]) ?? str(event["code"]) ?? "unknown error";
      throw classifyStreamError(message);
    }
    case "response.failed": {
      const response = obj(event["response"]);
      const error = response ? obj(response["error"]) : undefined;
      throw classifyStreamError(
        (error ? str(error["message"]) : undefined) ?? "the backend reported a failed response",
      );
    }
    case "response.created": {
      const response = obj(event["response"]);
      const id = response ? str(response["id"]) : undefined;
      if (id) into.responseId = id;
      break;
    }
    case "response.output_text.delta": {
      const delta = str(event["delta"]);
      if (delta) into.text += delta;
      break;
    }
    case "response.output_item.done": {
      const item = obj(event["item"]);
      if (!item || item["type"] !== "image_generation_call") break;

      const result = str(item["result"]);
      if (!result) {
        throw new CodexImageError(
          "NO_IMAGE",
          "The backend finished the image call without returning image data",
          "This is usually a content filter declining silently. Rephrase the prompt.",
        );
      }
      into.image = {
        result,
        status: str(item["status"]) ?? "completed",
        ...(str(item["revised_prompt"]) ? { revisedPrompt: str(item["revised_prompt"])! } : {}),
      };
      break;
    }
    case "response.completed": {
      const response = obj(event["response"]);
      if (!response) break;
      const id = str(response["id"]);
      if (id) into.responseId = id;
      const usage = obj(response["usage"]);
      if (usage) {
        into.usage = {
          ...(num(usage["input_tokens"]) !== undefined ? { inputTokens: num(usage["input_tokens"])! } : {}),
          ...(num(usage["output_tokens"]) !== undefined ? { outputTokens: num(usage["output_tokens"])! } : {}),
          ...(num(usage["total_tokens"]) !== undefined ? { totalTokens: num(usage["total_tokens"])! } : {}),
        };
      }
      break;
    }
  }
}

/**
 * A refusal and an outage arrive through the same channel, so the message is
 * the only thing that separates "the prompt is the problem" from "retry".
 */
function classifyStreamError(message: string): CodexImageError {
  const lower = message.toLowerCase();
  if (lower.includes("moderation") || lower.includes("safety") || lower.includes("content policy")) {
    return new CodexImageError("MODERATION", "The prompt was refused by content moderation", message);
  }
  if (lower.includes("rate limit") || lower.includes("quota") || lower.includes("too many")) {
    return new CodexImageError("RATE_LIMIT", "The image quota or rate limit is exhausted", message);
  }
  return new CodexImageError("PROTOCOL", "The backend reported an error mid-stream", message);
}

/**
 * Parse an SSE body into a response.
 *
 * Events are separated by a blank line and each may span several `data:`
 * lines. A partial event at the end of a chunk must survive until the rest
 * arrives, so the tail of the buffer is only consumed once terminated.
 */
export async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<ParsedResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parsed: ParsedResponse = { text: "" };
  let buffer = "";

  try {
    for (;;) {
      if (signal?.aborted) {
        throw new CodexImageError("ABORTED", "Image generation was cancelled");
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        consumeEvent(buffer.slice(0, boundary), parsed);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }

    // A stream that ends without a trailing blank line still owes us its last
    // event, which for a short response is the one carrying the image.
    if (buffer.trim()) consumeEvent(buffer, parsed);
  } finally {
    reader.releaseLock();
  }

  return parsed;
}

function consumeEvent(chunk: string, into: ParsedResponse): void {
  const data = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") return;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(data) as Record<string, unknown>;
  } catch {
    // A malformed frame is not worth failing a whole generation over; the
    // absence of an image is caught by the caller either way.
    return;
  }
  applyEvent(event, into);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
