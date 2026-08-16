// ── @av/codex-image ─────────────────────────────────────────────────────────
//
// Image generation and editing against OpenAI, over either a ChatGPT
// subscription (through the Codex backend) or the documented Images API.
//
// Deliberately knows nothing about Pi, episodes, channels or pipelines: the
// credential is injected, files are the caller's business, and the only thing
// that comes back is bytes plus provenance. Getting the subscription token out
// of Pi is the studio's job, not this package's.
// ---------------------------------------------------------------------------

export { CodexImageClient, mimeTypeFor } from "./client.js";
export { CodexImageError, type CodexImageErrorCode } from "./errors.js";
export {
  CODEX_RESPONSES_URL,
  buildRequestBody,
  buildHeaders,
  extractAccountId,
  applyEvent,
  parseSseStream,
  type ParsedResponse,
} from "./protocol.js";
export type {
  ClientOptions,
  GenerateRequest,
  GeneratedImage,
  InputImage,
  OutputFormat,
  Transport,
  Usage,
} from "./types.js";
