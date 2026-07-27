// ─── Fetch-based HTTP transport ───────────────────────────────────────
// Implements the Transport interface using the global fetch API (Node 18+).

import type { HttpRequest, HttpResponse, Transport } from "./types.js";
import { FalHttpError, FalNetworkError, FalCancelledError } from "./errors.js";

/**
 * Default fetch transport.  Injects no retry logic – that belongs at a
 * higher layer.  AbortSignal support is wired through natively.
 */
export class FetchTransport implements Transport {
  async request(
    req: HttpRequest,
    signal?: AbortSignal,
  ): Promise<HttpResponse> {
    let response: globalThis.Response;

    try {
      response = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body ?? undefined,
        signal,
        // Not following redirects – fal API does not use them.
        redirect: "manual",
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new FalCancelledError("HTTP request cancelled");
      }
      throw new FalNetworkError(
        err instanceof Error ? err.message : String(err),
      );
    }

    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const httpResponse: HttpResponse = {
      status: response.status,
      headers,
      body,
    };

    if (!response.ok) {
      const retryable =
        response.status === 429 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;
      throw new FalHttpError(response.status, body, retryable);
    }

    return httpResponse;
  }
}
