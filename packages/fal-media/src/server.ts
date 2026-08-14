// ---------------------------------------------------------------------------
// fal-media-adapter HTTP server
// ---------------------------------------------------------------------------
// Lightweight HTTP wrapper around FalClient exposing:
// - GET  /health  → model availability, balance status, rate limits
// - GET  /spend   → cumulative spend, per-job breakdowns
// - POST /generate → submit generation job
// - GET  /status/:requestId → poll job status
// ---------------------------------------------------------------------------

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createFalClient, type FalQueueClient } from "./client.js";
import { getProfile } from "./profiles.js";

interface ServerOptions {
  port?: number;
  host?: string;
}

export interface FalServerHandle {
  url: string;
  stop: () => Promise<void>;
  client: FalQueueClient;
}

interface GenerationRecord {
  profile: string;
  cost: { amount: number; currency: string };
  status: string;
  timestamp: string;
  requestId?: string;
  imageCount?: number;
}

/**
 * Create and start a fal-adapter HTTP server.
 */
export function createFalServer(opts: ServerOptions = {}): Promise<FalServerHandle> {
  const port = opts.port ?? 0; // 0 = OS-assigned
  const host = opts.host ?? "127.0.0.1";

  const client = createFalClient();
  const generations: GenerationRecord[] = [];

  return new Promise((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname;
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      };

      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      try {
        // ── Health ──────────────────────────────────────────────────────
        if (path === "/health" && req.method === "GET") {
          const key = process.env.FAL_KEY;
          const models: Record<string, string> = {};

          // Check which profiles are configured
          for (const pid of ["fal-ai/nano-banana-pro@v1", "fal-ai/flux/dev@v1"]) {
            try {
              const profile = getProfile(pid);
              models[pid] = profile ? "configured" : "unavailable";
            } catch {
              models[pid] = "unavailable";
            }
          }

          // Balance status from environment + cached data
          let balanceStatus = "unknown";
          if (!key) {
            balanceStatus = "unconfigured";
          } else if (generations.some(g => g.status === "COMPLETED")) {
            balanceStatus = "active";
          } else {
            // Key configured but no successful generations yet
            balanceStatus = "configured";
          }

          res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: balanceStatus === "active" ? "ready" : balanceStatus === "configured" ? "degraded" : balanceStatus,
            models,
            balance: { status: balanceStatus },
            spend: {
              totalUsd: client.totalSpendUsd,
              submissionCount: client.submissionCount,
            },
            timestamp: new Date().toISOString(),
          }));
          return;
        }

        // ── Spend ──────────────────────────────────────────────────────
        if (path === "/spend" && req.method === "GET") {
          res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({
            totalSpendUsd: client.totalSpendUsd,
            submissionCount: client.submissionCount,
            currency: "USD",
            generations: generations.slice(-20), // last 20 jobs
            timestamp: new Date().toISOString(),
          }));
          return;
        }

        // ── Generate ───────────────────────────────────────────────────
        if (path === "/generate" && req.method === "POST") {
          const body = await readBody(req);
          const { profile, params, num_images = 1 } = JSON.parse(body);

          const job = await client.submitAndWait({
            profile,
            params: { ...params, num_images },
          });

          const record: GenerationRecord = {
            profile,
            cost: job.cost ?? { amount: 0, currency: "USD" },
            status: job.status,
            timestamp: new Date().toISOString(),
            requestId: job.requestId,
            imageCount: job.images?.length,
          };
          generations.push(record);

          res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: job.status,
            cost: job.cost,
            images: job.images?.map((img: any) => img.url) ?? [],
            requestId: job.requestId,
          }));
          return;
        }

        // ── Job status ─────────────────────────────────────────────────
        const statusMatch = path.match(/^\/status\/(.+)$/);
        if (statusMatch && req.method === "GET") {
          const requestId = statusMatch[1]!;
          // Use the client's poll to check status
          // For simplicity, return cached info
          const gen = generations.find(g => g.requestId === requestId);
          if (gen) {
            res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
            res.end(JSON.stringify(gen));
          } else {
            res.writeHead(404, { ...corsHeaders, "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Job not found", requestId }));
          }
          return;
        }

        // ── 404 ────────────────────────────────────────────────────────
        res.writeHead(404, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found", path }));
      } catch (err) {
        res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Internal error",
          detail: err instanceof Error ? err.message : String(err),
        }));
      }
    });

    server.on("error", reject);

    server.listen(port, host, () => {
      const addr = server.address();
      const url = typeof addr === "string" ? addr : `http://${host}:${(addr as any)?.port}`;
      resolve({
        url,
        client,
        stop: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Read request body. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
