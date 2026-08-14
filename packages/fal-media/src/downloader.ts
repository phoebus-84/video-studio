// ─── File downloader ──────────────────────────────────────────────────
// Downloads a remote URL to a local path, with optional hash validation.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import type { DownloadResult, Downloader } from "./types.js";
import {
  FalDownloadError,
  FalCancelledError,
  FalNetworkError,
} from "./errors.js";

/**
 * HTTP-based downloader that streams the response body to a local file.
 * Hash validation runs on the completed file if `expectedSha256` is given.
 */
export class HttpDownloader implements Downloader {
  async download(
    url: string,
    destPath: string,
    expectedSha256?: string,
    signal?: AbortSignal,
  ): Promise<DownloadResult> {
    if (signal?.aborted) {
      throw new FalCancelledError("download cancelled before start");
    }

    let response: globalThis.Response;

    try {
      response = await fetch(url, { signal, redirect: "follow" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new FalCancelledError("download cancelled");
      }
      throw new FalNetworkError(
        err instanceof Error ? err.message : String(err),
      );
    }

    if (!response.ok) {
      throw new FalDownloadError(
        url,
        `HTTP ${response.status}`,
        response.status >= 500,
      );
    }

    const body = response.body;
    if (!body) {
      throw new FalDownloadError(url, "empty response body", false);
    }

    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader
      ? Number.parseInt(contentLengthHeader, 10)
      : 0;

    const hasher = expectedSha256 ? createHash("sha256") : null;
    const fileStream = createWriteStream(destPath);

    // Manual piping so we can tee into the hasher.
    const reader = body.getReader();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (hasher) hasher.update(value);
        fileStream.write(value);
      }
    } finally {
      reader.releaseLock();
      fileStream.end();
    }

    // Wait for the file stream to finish.
    await new Promise<void>((resolve, reject) => {
      fileStream.on("finish", resolve);
      fileStream.on("error", reject);
    });

    const sha256 = hasher ? hasher.digest("hex") : "";

    if (expectedSha256 && sha256 !== expectedSha256) {
      throw new FalDownloadError(
        url,
        `hash mismatch: expected ${expectedSha256}, got ${sha256}`,
        false,
      );
    }

    return { destPath, contentLength, sha256 };
  }
}
