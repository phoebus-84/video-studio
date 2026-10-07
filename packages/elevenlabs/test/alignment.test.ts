// forcedAlignment against a local fake of the ElevenLabs API: what is sent,
// how answers and failures are read, and the retry rules (UP-39).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ElevenLabsError, forcedAlignment } from "../src/index.js";

const KEY = "sk_test_never_print_me";
type Handler = (req: IncomingMessage, body: Buffer, res: ServerResponse) => void;
let server: Server;
let baseUrl: string;
let handlers: Handler[];
let requests: { headers: IncomingMessage["headers"]; body: string }[];
let dir: string;
let audio: string;
const waits: number[] = [];
const sleep = async (ms: number) => { waits.push(ms); };

beforeEach(async () => {
  handlers = [];
  requests = [];
  waits.length = 0;
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ headers: req.headers, body: body.toString("latin1") });
      const handler = handlers.shift();
      if (!handler) { res.writeHead(500); res.end(); return; }
      handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
  dir = mkdtempSync(join(tmpdir(), "elevenlabs-"));
  audio = join(dir, "take.wav");
  writeFileSync(audio, "RIFF fake audio");
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Handler => (_req, _body, res) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const WORDS = { words: [{ text: "La", start: 0.1, end: 0.3, loss: 0.2 }, { text: "nebbia", start: 0.3, end: 0.8, loss: 0.1 }], loss: 0.15 };
const align = () => forcedAlignment({ audioPath: audio, text: "La nebbia", apiKey: KEY, baseUrl, sleep });
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a failure"); }, (e: unknown) => e as ElevenLabsError);

describe("forcedAlignment", () => {
  it("sends the audio and the text with the key, and reads the words", async () => {
    handlers.push(json(200, WORDS));
    const result = await align();
    expect(result).toEqual(WORDS);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers["xi-api-key"]).toBe(KEY);
    expect(requests[0]!.headers["content-type"]).toMatch(/^multipart\/form-data/);
    expect(requests[0]!.body).toContain('name="text"');
    expect(requests[0]!.body).toContain("La nebbia");
    expect(requests[0]!.body).toContain('filename="take.wav"');
    expect(requests[0]!.body).toContain("RIFF fake audio");
  });

  it("waits Retry-After on 429, at most twice, then succeeds", async () => {
    handlers.push(json(429, { detail: "slow down" }, { "retry-after": "3" }), json(503, {}), json(200, WORDS));
    expect((await align()).words).toHaveLength(2);
    expect(waits).toEqual([3000, 4000]);
  });

  it("gives up after two retries", async () => {
    handlers.push(json(429, {}), json(429, {}), json(429, { detail: "still too fast" }));
    const error = await failure(align());
    expect(error.code).toBe("rate-limited");
    expect(requests).toHaveLength(3);
  });

  it("never retries a refused key or a spent quota", async () => {
    handlers.push(json(401, { detail: { status: "invalid_api_key", message: `key ${KEY} is not valid` } }));
    const auth = await failure(align());
    expect(auth.code).toBe("auth");
    expect(auth.message).not.toContain(KEY);
    handlers.push(json(401, { detail: { status: "quota_exceeded", message: "no credits left" } }));
    expect((await failure(align())).code).toBe("quota");
    expect(requests).toHaveLength(2);
    expect(waits).toEqual([]);
  });

  it("reports a bad request without retrying", async () => {
    handlers.push(json(422, { detail: "text is empty" }));
    const error = await failure(align());
    expect([error.code, error.status, error.message]).toEqual(["bad-request", 422, "ElevenLabs refused the request: text is empty"]);
  });

  it("calls a connection cut after the request uncertain, and does not retry it", async () => {
    handlers.push((_req, _body, res) => res.socket?.destroy());
    const error = await failure(align());
    expect(error.code).toBe("uncertain");
    expect(requests).toHaveLength(1);
  });

  it("says nothing was sent when no connection could be made", async () => {
    // A port that was just freed: nothing listens there.
    const spare = createServer();
    await new Promise<void>((resolve) => spare.listen(0, "127.0.0.1", resolve));
    const { port } = spare.address() as { port: number };
    await new Promise<void>((resolve) => spare.close(() => resolve()));
    const error = await failure(forcedAlignment({ audioPath: audio, text: "La", apiKey: KEY, baseUrl: `http://127.0.0.1:${port}`, sleep }));
    expect(error.code).toBe("unreachable");
  });

  it("keeps the key out of every error", async () => {
    for (const handler of [json(500, { detail: `boom ${KEY}` }), json(500, {}), json(500, {})]) handlers.push(handler);
    const error = await failure(align());
    expect(error.code).toBe("server");
    expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain(KEY);
  });

  it("sends one request at a time", async () => {
    let open = 0;
    let most = 0;
    const slow: Handler = (_req, _body, res) => {
      open++;
      most = Math.max(most, open);
      setTimeout(() => { open--; json(200, WORDS)(_req, _body, res); }, 30);
    };
    handlers.push(slow, slow, slow);
    await Promise.all([align(), align(), align()]);
    expect(most).toBe(1);
  });
});
