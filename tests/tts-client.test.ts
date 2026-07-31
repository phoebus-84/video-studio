import { describe, expect, it, vi } from "vitest";
import { QwenTtsClient } from "../src/tts-client.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const completed = {
  job_id: "job-1", phase: "completed", segment: {}, profile: {},
  request_fingerprint: "a".repeat(64), provider_mode: "fake",
  attempt_id: "attempt-1", cache_hit: false, retry_count: 0,
  recovered_after_restart: false,
};

describe("QwenTtsClient", () => {
  it("negotiates the supported API version and rejects incompatible workers", async () => {
    const compatible = new QwenTtsClient({ baseUrl: "http://worker", fetchImpl: vi.fn(async () => response({ info: { version: "0.1.0" } })) as any });
    await expect(compatible.assertCompatible()).resolves.toBe("0.1.0");
    const incompatible = new QwenTtsClient({ baseUrl: "http://worker", fetchImpl: vi.fn(async () => response({ info: { version: "2.0.0" } })) as any });
    await expect(incompatible.assertCompatible()).rejects.toMatchObject({ code: "api_version_incompatible" });
  });

  it("submits and resumes a fake durable segment without losing provider labels", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ ...completed, phase: "queued", attempt_id: null }))
      .mockResolvedValueOnce(response({ ...completed, phase: "running", attempt_id: null }))
      .mockResolvedValueOnce(response(completed));
    const client = new QwenTtsClient({ baseUrl: "http://worker/", fetchImpl: fetchImpl as any });
    const submitted = await client.submitSegment({ segmentId: "s1" }, { profileId: "p1" });
    expect(submitted.provider_mode).toBe("fake");
    const terminal = await client.waitForTerminal(submitted.job_id, { pollMs: 0 });
    expect(terminal.phase).toBe("completed");
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://worker/attempt-jobs");
  });

  it("preserves worker machine error codes and details", async () => {
    const client = new QwenTtsClient({
      baseUrl: "http://worker",
      fetchImpl: vi.fn(async () => response({
        error: "Request body exceeds local safety limit",
        detail: [{ type: "request_too_large", msg: "maximum=100" }],
      }, 413)) as any,
    });
    await expect(client.cancel("job")).rejects.toEqual(expect.objectContaining({
      name: "TtsWorkerError", status: 413, code: "request_too_large",
    }));
  });

  it("propagates caller abort while polling", async () => {
    const client = new QwenTtsClient({
      baseUrl: "http://worker",
      fetchImpl: vi.fn(async () => response({ ...completed, phase: "running", attempt_id: null })) as any,
    });
    const controller = new AbortController();
    const waiting = client.waitForTerminal("job-1", { pollMs: 1000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("caller cancelled")), 5);
    await expect(waiting).rejects.toThrow("caller cancelled");
  });

  it("uses exact lifecycle endpoints for validate/process/retry/master", async () => {
    const fetchImpl = vi.fn(async () => response({}));
    const client = new QwenTtsClient({ baseUrl: "http://worker", fetchImpl: fetchImpl as any });
    await client.validate("j", 12);
    await client.process("j", "r", 250);
    await client.retryQuality("j", "r");
    await client.master({ entries: [] });
    expect((fetchImpl.mock.calls as unknown[][]).map((call) => call[0])).toEqual([
      "http://worker/attempt-jobs/j/validate",
      "http://worker/attempt-jobs/j/process",
      "http://worker/attempt-jobs/j/retry-quality",
      "http://worker/narrations/master",
    ]);
  });
});
