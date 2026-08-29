import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FalClientImpl } from "../src/client.js";
import { VideoProfileContract, ProfileContract } from "../src/contracts/v1.js";
import { MockServer } from "./fixtures/mock-server.js";
import { ManualClock } from "../src/clock.js";
import { NoopSleeper } from "../src/sleeper.js";
import { createLogger } from "../src/logger.js";
import { minimaxH3TextToVideo, fluxDevV1 } from "../src/profiles.js";
import { FalCancelledError, FalTimeoutError, FalAdapterError } from "../src/errors.js";
import type { LogEntry } from "../src/logger.js";
import type { GenerationInput, FalAdapterConfig } from "../src/types.js";

/**
 * Long generations — anything video — cannot finish inside one request, so they
 * go through fal's queue.
 *
 * The legacy client polled the queue but parsed `images` out of the response
 * itself, so a video endpoint completed successfully with no outputs at all.
 * Here the completed payload goes to the same versioned contract that parses a
 * synchronous response, which is the whole point of converging the two.
 *
 * The queue speaks through two distinct endpoints, and the submit response
 * names both: `status_url` at `.../requests/<id>/status` answers how the job is
 * going, `response_url` at `.../requests/<id>` holds the finished payload.
 * These tests once modelled a single URL serving both, which let the client
 * poll the result endpoint for status and still pass.
 */
describe("queue submission", () => {
  let server: MockServer;
  let logs: LogEntry[];

  const config = (): FalAdapterConfig => ({
    falKey: "fal-test-key",
    baseUrl: server.url,
    defaultTimeoutMs: 30_000,
    maxRetries: 3,
  });

  const client = () =>
    new FalClientImpl({
      config: config(),
      contracts: [new VideoProfileContract(minimaxH3TextToVideo), new ProfileContract(fluxDevV1)],
      clock: new ManualClock(1_000_000),
      sleeper: new NoopSleeper(),
      logger: createLogger((e) => logs.push(e)),
      queueUrl: server.url,
    });

  const input = (endpointId = "minimax/h3/text-to-video"): GenerationInput => ({
    idempotencyKey: "queue-key",
    binding: { endpointId, contractVersion: "v1", baseUrl: server.url },
    parameters: { prompt: "a quiet street at dusk" },
    timeoutMs: 60_000,
  });

  /** The paths fal serves for a queued job, and the URLs it hands back. */
  const queue = (endpointId: string, requestId: string) => {
    const resultPath = `/${endpointId}/requests/${requestId}`;
    return {
      resultPath,
      statusPath: `${resultPath}/status`,
      /** What the submit response carries, as fal actually sends it. */
      urls: {
        response_url: `${server.url}${resultPath}`,
        status_url: `${server.url}${resultPath}/status`,
      },
    };
  };

  const pathsHit = (method: string): string[] =>
    server.received.filter((r) => r.method === method).map((r) => r.path);

  beforeAll(async () => {
    server = new MockServer();
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    server.reset();
    logs = [];
  });

  it("polls the status endpoint and fetches the result the queue points at", async () => {
    const q = queue("minimax/h3/text-to-video", "req-q-1");
    server.expect("POST", "/minimax/h3/text-to-video", 200, {
      request_id: "req-q-1",
      status: "IN_QUEUE",
      ...q.urls,
    });
    server.expect("GET", q.statusPath, 200, { status: "IN_PROGRESS" });
    // A completed job reports completion and nothing else; the payload lives at
    // the result endpoint.
    server.expect("GET", q.statusPath, 200, { status: "COMPLETED" });
    server.expect("GET", q.resultPath, 200, {
      video: {
        url: "https://fal.media/files/scene.mp4",
        content_type: "video/mp4",
        file_size: 9_100_000,
      },
    });

    const result = await client().submitAndWait(input());

    // The legacy path would have returned zero outputs here.
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]!.url).toBe("https://fal.media/files/scene.mp4");
    expect(result.outputs[0]!.contentType).toBe("video/mp4");
    expect(result.providerRequestId).toBe("req-q-1");

    // Status twice, then the result once — and the result endpoint is never
    // polled for status, which is what the single-URL client did.
    expect(pathsHit("GET")).toEqual([q.statusPath, q.statusPath, q.resultPath]);
  });

  it("derives both URLs when the queue names neither", async () => {
    // Not every endpoint returns the pointers. The derived pair must still be
    // two distinct endpoints, not one URL used for both jobs.
    const q = queue("minimax/h3/text-to-video", "req-q-7");
    server.expect("POST", "/minimax/h3/text-to-video", 200, {
      request_id: "req-q-7",
      status: "IN_QUEUE",
    });
    server.expect("GET", q.statusPath, 200, { status: "COMPLETED" });
    server.expect("GET", q.resultPath, 200, {
      video: { url: "https://fal.media/derived.mp4", content_type: "video/mp4" },
    });

    const result = await client().submitAndWait(input());

    expect(result.outputs[0]!.url).toBe("https://fal.media/derived.mp4");
    expect(pathsHit("GET")).toEqual([q.statusPath, q.resultPath]);
  });

  it("obeys the URLs fal sends rather than the ones it could derive", async () => {
    // fal is free to serve a job from somewhere other than the conventional
    // path. Deriving the URL anyway would poll a job that is not this one.
    const derived = queue("minimax/h3/text-to-video", "req-q-8");
    server.expect("POST", "/minimax/h3/text-to-video", 200, {
      request_id: "req-q-8",
      status: "IN_QUEUE",
      status_url: `${server.url}/elsewhere/req-q-8/status`,
      response_url: `${server.url}/elsewhere/req-q-8`,
    });
    server.expect("GET", "/elsewhere/req-q-8/status", 200, { status: "COMPLETED" });
    server.expect("GET", "/elsewhere/req-q-8", 200, {
      video: { url: "https://fal.media/elsewhere.mp4", content_type: "video/mp4" },
    });

    const result = await client().submitAndWait(input());

    expect(result.outputs[0]!.url).toBe("https://fal.media/elsewhere.mp4");
    expect(pathsHit("GET")).not.toContain(derived.statusPath);
    expect(pathsHit("GET")).not.toContain(derived.resultPath);
  });

  it("follows a result pointer the status body carries", async () => {
    // The status response can redirect the result fetch mid-flight; that
    // pointer wins over the one the submit response named.
    const q = queue("minimax/h3/text-to-video", "req-q-9");
    server.expect("POST", "/minimax/h3/text-to-video", 200, {
      request_id: "req-q-9",
      status: "IN_QUEUE",
      ...q.urls,
    });
    server.expect("GET", q.statusPath, 200, {
      status: "COMPLETED",
      response_url: `${server.url}/moved/req-q-9`,
    });
    server.expect("GET", "/moved/req-q-9", 200, {
      video: { url: "https://fal.media/moved.mp4", content_type: "video/mp4" },
    });

    const result = await client().submitAndWait(input());

    expect(result.outputs[0]!.url).toBe("https://fal.media/moved.mp4");
    expect(pathsHit("GET")).toContain("/moved/req-q-9");
  });

  it("takes the result inline when the status carries it", async () => {
    // Some endpoints answer status with the payload already attached. Fetching
    // the result endpoint as well would be a wasted round trip.
    const q = queue("minimax/h3/text-to-video", "req-q-10");
    server.expect("POST", "/minimax/h3/text-to-video", 200, {
      request_id: "req-q-10",
      status: "IN_QUEUE",
      ...q.urls,
    });
    server.expect("GET", q.statusPath, 200, {
      status: "COMPLETED",
      result: { video: { url: "https://fal.media/inline.mp4", content_type: "video/mp4" } },
    });

    const result = await client().submitAndWait(input());

    expect(result.outputs[0]!.url).toBe("https://fal.media/inline.mp4");
    expect(pathsHit("GET")).toEqual([q.statusPath]);
  });

  it("records spend from the profile rather than a table beside the client", async () => {
    const q = queue("minimax/h3/text-to-video", "req-q-2");
    server.expect("POST", "/minimax/h3/text-to-video", 200, {
      request_id: "req-q-2",
      status: "IN_QUEUE",
      ...q.urls,
    });
    server.expect("GET", q.statusPath, 200, {
      status: "COMPLETED",
      result: { video: { url: "https://fal.media/a.mp4", content_type: "video/mp4" } },
    });

    const c = client();
    await c.submitAndWait(input());

    expect(c.submissionCount).toBe(1);
    expect(c.totalSpendUsd).toBe(minimaxH3TextToVideo.pricing.estimatedUnitCost);
  });

  it("fails when fal accepts the job but returns no request id", async () => {
    server.expect("POST", "/minimax/h3/text-to-video", 200, { status: "IN_QUEUE" });

    await expect(client().submitAndWait(input())).rejects.toMatchObject({
      code: "FAL_CONTRACT_ERROR",
    });
  });

  it("surfaces a failed job rather than waiting out the timeout", async () => {
    const q = queue("minimax/h3/text-to-video", "req-q-3");
    server.expect("POST", "/minimax/h3/text-to-video", 200, {
      request_id: "req-q-3",
      status: "IN_QUEUE",
      ...q.urls,
    });
    server.expect("GET", q.statusPath, 200, {
      status: "FAILED",
      error: "content policy",
    });

    await expect(client().submitAndWait(input())).rejects.toMatchObject({
      code: "FAL_JOB_FAILED",
    });
  });

  it("refuses to start when already cancelled", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(client().submitAndWait(input(), ac.signal)).rejects.toThrow(FalCancelledError);
  });

  it("times out rather than polling forever", async () => {
    server.expect("POST", "/minimax/h3/text-to-video", 200, {
      request_id: "req-q-4",
      status: "IN_QUEUE",
    });
    // A clock that never advances would poll forever; a zero budget must stop
    // before the first request instead.
    await expect(
      client().submitAndWait(input(), undefined, { maxWaitMs: 0 }),
    ).rejects.toThrow(FalTimeoutError);
  });

  it("still refuses an unregistered contract version", async () => {
    const bad = { ...input(), binding: { ...input().binding, contractVersion: "v99" } };
    await expect(client().submitAndWait(bad)).rejects.toMatchObject({
      code: "FAL_UNKNOWN_CONTRACT",
    });
  });

  it("redacts the key when queuing, as the synchronous path does", async () => {
    const q = queue("minimax/h3/text-to-video", "req-q-5");
    server.expect("POST", "/minimax/h3/text-to-video", 200, {
      request_id: "req-q-5",
      status: "IN_QUEUE",
      ...q.urls,
    });
    server.expect("GET", q.statusPath, 200, {
      status: "COMPLETED",
      result: { video: { url: "https://fal.media/b.mp4", content_type: "video/mp4" } },
    });

    await client().submitAndWait(input());

    const submit = logs.find((e) => e.msg === "fal submit");
    expect(submit?.falKey).toBe("***REDACTED***");
    expect(submit?.queued).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("fal-test-key");
  });

  it("carries images through the queue too, not only video", async () => {
    const q = queue("fal-ai/flux/dev", "req-q-6");
    server.expect("POST", "/fal-ai/flux/dev", 200, {
      request_id: "req-q-6",
      status: "IN_QUEUE",
      ...q.urls,
    });
    server.expect("GET", q.statusPath, 200, { status: "COMPLETED" });
    server.expect("GET", q.resultPath, 200, {
      images: [{ url: "https://fal.media/i.png", content_type: "image/png" }],
    });

    const result = await client().submitAndWait(input("fal-ai/flux/dev"));
    expect(result.outputs[0]!.contentType).toBe("image/png");
  });
});
