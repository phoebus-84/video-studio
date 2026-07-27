// ---------------------------------------------------------------------------
// Pi RPC client tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { PiRpcClient, RpcTimeoutError, RpcDisconnectedError, isRpcEvent, isRpcError, isRpcResult, uuid } from "../src/rpc/client.js";
import { PassThrough } from "node:stream";

// ── Mock setup ──────────────────────────────────────────────────────────────

let latestMock: any = null;

vi.mock("node:child_process", () => {
  const { PassThrough } = require("node:stream") as typeof import("node:stream");
  const { EventEmitter } = require("node:events") as typeof import("node:events");

  return {
    spawn: vi.fn(() => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const proc = Object.assign(new EventEmitter(), {
        stdin, stdout, stderr,
        pid: 12345, killed: false,
        kill: vi.fn((signal?: string) => {
          proc.killed = true;
          proc.emit("exit", 0, signal ?? "SIGTERM");
          return true;
        }),
      });
      latestMock = proc;
      return proc;
    }),
  };
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function getStdout(): PassThrough { return latestMock?.stdout as PassThrough; }
function getStderr(): PassThrough { return latestMock?.stderr as PassThrough; }
function getStdin(): PassThrough { return latestMock?.stdin as PassThrough; }

async function readStdinWritten(): Promise<string> {
  await new Promise((r) => setTimeout(r, 10));
  return (getStdin()?.read()?.toString() ?? "");
}

function extractId(written: string): string | null {
  const m = written.match(/"id":"(rpc-[^"]+)"/);
  return m ? m[1]! : null;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("PiRpcClient", () => {
  afterEach(() => { latestMock = null; vi.clearAllMocks(); });

  describe("connection lifecycle", () => {
    it("starts disconnected", () => {
      const c = new PiRpcClient();
      expect(c.currentState).toBe("disconnected");
      expect(c.processPid).toBeNull();
    });

    it("connects and transitions state", async () => {
      const c = new PiRpcClient();
      const states: string[] = [];
      c.on("state", (s) => states.push(s));
      await c.connect();
      expect(c.currentState).toBe("connected");
      expect(states).toContain("starting");
      expect(states).toContain("connected");
    });

    it("shuts down gracefully", async () => {
      const c = new PiRpcClient();
      await c.connect();
      await c.shutdown();
      expect(c.currentState).toBe("disconnected");
    });

    it("rejects requests when disconnected", async () => {
      const c = new PiRpcClient();
      await expect(c.request("test.ping")).rejects.toThrow(RpcDisconnectedError);
    });
  });

  describe("request / response", () => {
    it("sends request and resolves", async () => {
      const c = new PiRpcClient();
      await c.connect();
      const promise = c.request("test.ping", { hello: "world" });
      const written = await readStdinWritten();
      expect(written).toContain('"method":"test.ping"');
      const id = extractId(written);
      expect(id).toBeTruthy();

      getStdout()?.write(JSON.stringify({ id, result: { pong: true } }) + "\n");
      expect(await promise).toEqual({ pong: true });
    });

    it("handles error responses", async () => {
      const c = new PiRpcClient();
      await c.connect();
      const promise = c.request("test.fail");
      const written = await readStdinWritten();
      const id = extractId(written);

      getStdout()?.write(JSON.stringify({ id, error: { code: -32600, message: "Invalid request" } }) + "\n");
      await expect(promise).rejects.toThrow("Invalid request");
    });

    it("times out", async () => {
      const c = new PiRpcClient({ defaultTimeoutMs: 100 });
      await c.connect();
      await expect(c.request("test.slow", {}, 50)).rejects.toThrow(RpcTimeoutError);
    });

    it("notify sends fire-and-forget", async () => {
      const c = new PiRpcClient();
      await c.connect();
      c.notify("test.fire", { x: 1 });
      const written = await readStdinWritten();
      expect(written).toContain('"method":"test.fire"');
      expect(written).not.toContain('"id":');
      expect(c.pendingCount).toBe(0);
    });
  });

  describe("events", () => {
    it("emits typed events from stdout", async () => {
      const c = new PiRpcClient();
      await c.connect();
      const events: any[] = [];
      c.on("event", (e) => events.push(e));

      getStdout()?.write(JSON.stringify({ type: "stage.started", data: { stageId: "write-brief" } }) + "\n");
      await new Promise((r) => setTimeout(r, 10));
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("stage.started");
      expect(events[0].data.stageId).toBe("write-brief");
    });
  });

  describe("stderr capture", () => {
    it("captures stderr without interfering with framing", async () => {
      const c = new PiRpcClient();
      await c.connect();
      const lines: string[] = [];
      c.on("stderr", (l) => lines.push(l));
      getStderr()?.write("warning: disk low\ninfo: retry\n");
      await new Promise((r) => setTimeout(r, 10));
      expect(lines).toContain("warning: disk low");
      expect(lines).toContain("info: retry");
    });

    it("recentStderr returns and clears", async () => {
      const c = new PiRpcClient();
      await c.connect();
      getStderr()?.write("line one\nline two\n");
      await new Promise((r) => setTimeout(r, 10));
      expect(c.recentStderr).toEqual(["line one", "line two"]);
      expect(c.recentStderr).toEqual([]);
    });
  });

  describe("JSONL framing", () => {
    it("handles CRLF line endings", async () => {
      const c = new PiRpcClient();
      await c.connect();
      const promise = c.request("test.crlf");
      const written = await readStdinWritten();
      const id = extractId(written);

      getStdout()?.write(JSON.stringify({ id, result: "ok" }) + "\r\n");
      expect(await promise).toBe("ok");
    });

    it("preserves U+2028/U+2029 within JSON strings", async () => {
      const c = new PiRpcClient();
      await c.connect();
      const events: any[] = [];
      c.on("event", (e) => events.push(e));

      const text = "Line one\u2028Line two\u2029Paragraph end";
      getStdout()?.write(JSON.stringify({ type: "content", data: { text } }) + "\n");
      await new Promise((r) => setTimeout(r, 10));
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("content");
      expect(events[0].data.text).toBe(text);
    });

    it("splits multiple lines in one chunk", async () => {
      const c = new PiRpcClient();
      await c.connect();
      const events: any[] = [];
      c.on("event", (e) => events.push(e));

      getStdout()?.write('{"type":"e1","data":{"n":1}}\n{"type":"e2","data":{"n":2}}\n{"type":"e3","data":{"n":3}}\n');
      await new Promise((r) => setTimeout(r, 10));
      expect(events.length).toBe(3);
      expect(events.map((e) => e.data.n)).toEqual([1, 2, 3]);
    });

    it("skips empty and whitespace-only lines", async () => {
      const c = new PiRpcClient();
      await c.connect();
      const events: any[] = [];
      c.on("event", (e) => events.push(e));

      getStdout()?.write('\n  \n{"type":"e1","data":{}}\n\n{"type":"e2","data":{}}\n');
      await new Promise((r) => setTimeout(r, 10));
      expect(events.length).toBe(2);
    });
  });

  describe("reconnection", () => {
    it("transitions to reconnecting on process exit", async () => {
      const c = new PiRpcClient();
      await c.connect();
      const states: string[] = [];
      c.on("state", (s) => states.push(s));

      latestMock.emit("exit", 1, null);
      await new Promise((r) => setTimeout(r, 10));
      expect(states).toContain("reconnecting");
      expect(c.currentState).toBe("reconnecting");
    });
  });

  describe("helpers", () => {
    it("uuid generates unique values", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) ids.add(uuid());
      expect(ids.size).toBe(100);
    });

    it("isRpcEvent detects events", () => {
      expect(isRpcEvent({ type: "e", data: {} } as any)).toBe(true);
      expect(isRpcEvent({ id: "1", result: {} } as any)).toBe(false);
    });

    it("isRpcError detects errors", () => {
      expect(isRpcError({ id: "1", error: { code: 1, message: "err" } } as any)).toBe(true);
      expect(isRpcError({ id: "1", result: {} } as any)).toBe(false);
    });

    it("isRpcResult detects results", () => {
      expect(isRpcResult({ id: "1", result: {} } as any)).toBe(true);
      expect(isRpcResult({ type: "e", data: {} } as any)).toBe(false);
    });
  });
});
