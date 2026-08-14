import { expect, test } from "vitest";
import {
  GatewayClient,
  GatewayClientError,
  parseWsEvent,
} from "$contracts/client";

/* Mock fetch that returns a successful JSON response. */
function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: async () => body,
    }) as Response) as typeof fetch;
}

test("health returns a typed health report", async () => {
  const client = new GatewayClient({
    baseUrl: "http://127.0.0.1:9999",
    tokenProvider: () => null,
    fetch: mockFetch({
      overall: "healthy",
      timestamp: "2026-01-01T00:00:00Z",
      gateway: { status: "ready", detail: "", lastChecked: "" },
      runtime: { status: "ready", detail: "", lastChecked: "" },
      pi: { status: "ready", detail: "", lastChecked: "" },
      adapter: { status: "ready", detail: "", lastChecked: "" },
    }),
  });

  const report = await client.health();
  expect(report.overall).toBe("healthy");
  expect(report.gateway.status).toBe("ready");
});

test("authenticated requests include bearer header", async () => {
  let capturedHeaders: Record<string, string> = {};

  const capturingFetch: typeof fetch = async (_input, init) => {
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [],
    } as Response;
  };

  const client = new GatewayClient({
    baseUrl: "http://127.0.0.1:9999",
    tokenProvider: () => "test-token-abc",
    fetch: capturingFetch,
  });

  await client.listChannels();
  expect(capturedHeaders["Authorization"]).toBe("Bearer test-token-abc");
});

test("health endpoint does not require authentication", async () => {
  let capturedHeaders: Record<string, string> = {};

  const capturingFetch: typeof fetch = async (_input, init) => {
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ overall: "healthy" }),
    } as Response;
  };

  const client = new GatewayClient({
    baseUrl: "http://127.0.0.1:9999",
    tokenProvider: () => "token",
    fetch: capturingFetch,
  });

  await client.health();
  expect(capturedHeaders["Authorization"]).toBeUndefined();
});

test("error responses become GatewayClientError", async () => {
  const client = new GatewayClient({
    baseUrl: "http://127.0.0.1:9999",
    tokenProvider: () => null,
    fetch: mockFetch(
      { error: "unauthorized", message: "bad token", correlationId: "abc-123" },
      401,
    ),
  });

  await expect(() => client.listChannels()).rejects.toThrow(GatewayClientError);
  try {
    await client.listChannels();
  } catch (e) {
    const err = e as GatewayClientError;
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthorized");
  }
});

test("parseWsEvent returns a valid WsEvent", () => {
  const event = parseWsEvent(
    JSON.stringify({
      type: "stage.progress",
      sequence: 1,
      timestamp: "2026-01-01T00:00:00Z",
      episode: "my-episode",
      payload: { stage: "script", progress: 0.5 },
    }),
  );
  expect(event).not.toBeNull();
  expect(event!.type).toBe("stage.progress");
  expect(event!.episode).toBe("my-episode");
});

test("parseWsEvent returns null for malformed payloads", () => {
  expect(parseWsEvent("not json")).toBeNull();
  expect(parseWsEvent("{}")).toBeNull();
  expect(parseWsEvent(JSON.stringify({ type: "x" }))).toBeNull();
});

test("parseWsEvent returns null for non-event heartbeat", () => {
  expect(parseWsEvent(": heartbeat")).toBeNull();
});
