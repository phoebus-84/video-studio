// ─── Mock HTTP server fixture ─────────────────────────────────────────
// Provides a lightweight HTTP server for testing without real network.
// Tests can set up expected routes, responses, and inspect received
// requests.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockRoute {
  method: string;
  path: string;
  status: number;
  headers?: Record<string, string>;
  body?: string | object;
  /** Delay before responding (ms).  Default 0. */
  delayMs?: number;
}

export interface ReceivedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * A mock fal API server for deterministic integration tests.
 *
 * Usage:
 *   const server = new MockServer();
 *   await server.start();
 *   server.expect("POST", "/fal-ai/flux/dev", 200, { request_id: "abc", status: "COMPLETED", result: { images: [{ url: "https://example.com/o.png", content_type: "image/png" }] } });
 *   // ... run test ...
 *   const reqs = server.received;
 *   await server.stop();
 */
export class MockServer {
  private server: ReturnType<typeof createServer> | null = null;
  private routes: MockRoute[] = [];
  private _received: ReceivedRequest[] = [];
  private _port = 0;

  get port(): number {
    return this._port;
  }

  get url(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  get received(): readonly ReceivedRequest[] {
    return this._received;
  }

  /** Register an expected route. */
  expect(
    method: string,
    path: string,
    status: number,
    body?: string | object,
    opts?: { headers?: Record<string, string>; delayMs?: number },
  ): void {
    this.routes.push({
      method: method.toUpperCase(),
      path,
      status,
      body,
      headers: opts?.headers,
      delayMs: opts?.delayMs,
    });
  }

  /** Clear all routes and received requests. */
  reset(): void {
    this.routes.length = 0;
    this._received.length = 0;
  }

  /** Start the mock server on an ephemeral port. */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handle(req, res));
      this.server.on("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address() as AddressInfo;
        this._port = addr.port;
        resolve();
      });
    });
  }

  /** Stop the mock server. */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
      this.server = null;
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const path = req.url ?? "/";

    const received: ReceivedRequest = {
      method: req.method ?? "GET",
      path,
      headers: req.headers as Record<string, string>,
      body,
    };
    this._received.push(received);

    const route = this.routes.find(
      (r) => r.method === req.method && r.path === path,
    );

    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found", path }));
      return;
    }

    if (route.delayMs && route.delayMs > 0) {
      await new Promise((r) => setTimeout(r, route.delayMs));
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...route.headers,
    };
    res.writeHead(route.status, headers);
    const bodyStr =
      typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    res.end(bodyStr);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}
