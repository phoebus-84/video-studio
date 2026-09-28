// ---------------------------------------------------------------------------
// Pi RPC JSONL client
// ---------------------------------------------------------------------------
// Communicates with Pi over stdin/stdout using strict JSONL framing.
// Uses a custom \n-only parser (NOT Node readline) to preserve
// U+2028/U+2029 inside JSON strings without splitting records.
// ---------------------------------------------------------------------------

import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { OPERATOR_KEY_ENV, HEADLESS_ENV } from "@studio/contracts/src/operator-key.mjs";

// ── Types ───────────────────────────────────────────────────────────────────

export type RequestId = string;

export interface RpcRequest {
  id: RequestId;
  method: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
}

export interface RpcResult {
  id: RequestId;
  result: unknown;
}

export interface RpcError {
  id: RequestId;
  error: { code: number; message: string; data?: unknown };
}

export interface RpcEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

export type RpcMessage = RpcResult | RpcError | RpcEvent;

export interface RpcClientOptions {
  piCommand?: string;
  piArgs?: string[];
  cwd?: string;
  defaultTimeoutMs?: number;
  maxLineBytes?: number;
}

export type RpcState =
  | "disconnected" | "starting" | "connected"
  | "degraded" | "reconnecting" | "shutdown";

/**
 * The environment Pi is spawned with: everything this process has, minus
 * the operator key's location (avg-qr4.3). Pi must never be given, pointed
 * at, or able to discover through its config the operator key file — an
 * operator who exported `AVG_OPERATOR_KEY_FILE` for the gateway or the CLI
 * would otherwise hand that same pointer to every Pi session, and Pi holds
 * only the agent token.
 */
export function piSpawnEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { [OPERATOR_KEY_ENV]: _operatorKeyFile, ...rest } = env;
  // Headless (avg-qr4.3 final review, I4): Pi's bash tool runs `vpr` as the
  // operator's own user, and the CLI's default key path made that shell the
  // operator by accident. With this set, `resolveCliCredential` answers
  // "agent" without reading the key. It stops accidents, not a process that
  // unsets it and reads the file itself — that boundary is avg-qr4.8.
  return { ...rest, [HEADLESS_ENV]: "1" };
}

// ── Errors ──────────────────────────────────────────────────────────────────

export enum RpcErrorCode {
  TIMEOUT = -32000,
  DISCONNECTED = -32001,
  INVALID_RESPONSE = -32002,
  PROTOCOL_ERROR = -32003,
}

export class RpcTimeoutError extends Error {
  code = RpcErrorCode.TIMEOUT;
  constructor(requestId: RequestId, timeoutMs: number) {
    super(`RPC request ${requestId} timed out after ${timeoutMs}ms`);
    this.name = "RpcTimeoutError";
  }
}

export class RpcDisconnectedError extends Error {
  code = RpcErrorCode.DISCONNECTED;
  constructor(message = "Pi RPC connection is not active") {
    super(message);
    this.name = "RpcDisconnectedError";
  }
}

// ── Custom line parser ──────────────────────────────────────────────────────

/**
 * Parse lines from a Readable stream using only \n as delimiter.
 * This does NOT split on U+2028 or U+2029, preserving Unicode
 * line separators inside JSON strings.
 */
function parseLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
  maxLineBytes: number,
): { close(): void } {
  let buffer = "";

  stream.setEncoding("utf-8");

  const onData = (chunk: string): void => {
    buffer += chunk;

    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);

      // Strip trailing CR
      line = line.replace(/\r$/, "");

      // Skip empty / whitespace-only lines
      if (!line.trim()) continue;

      // Max line size guard
      if (line.length > maxLineBytes) continue;

      onLine(line);
    }
  };

  stream.on("data", onData);

  return {
    close() {
      stream.off("data", onData);
    },
  };
}

// ── Pi RPC Client ───────────────────────────────────────────────────────────

export class PiRpcClient extends EventEmitter {
  private piCmd: string;
  private piArgs: string[];
  private cwd: string;
  private defaultTimeoutMs: number;
  private maxLineBytes: number;
  private proc: ChildProcess | null = null;
  private parser: { close(): void } | null = null;
  private state: RpcState = "disconnected";
  private pending = new Map<RequestId, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private reqCounter = 0;
  private stderrBuf: string[] = [];

  constructor(options: RpcClientOptions = {}) {
    super();
    this.piCmd = options.piCommand ?? "pi";
    this.piArgs = options.piArgs ?? [];
    this.cwd = options.cwd ?? process.cwd();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.maxLineBytes = options.maxLineBytes ?? 1_048_576;
  }

  // ── Connection ────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.state === "connected") return;
    this.setState("starting");

    return new Promise<void>((resolveCb, rejectCb) => {
      const p = spawn(this.piCmd, this.piArgs, {
        cwd: this.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        // Not a bare `{ ...process.env }` (avg-qr4.3): see `piSpawnEnv`.
        env: piSpawnEnv(),
      });

      p.on("error", (err) => {
        this.setState("disconnected");
        rejectCb(new Error(`Failed to start Pi process: ${err.message}`));
      });

      p.on("exit", (code, signal) => {
        this.onDisconnect(code, signal);
      });

      // Stderr — diagnostics only, never interferes with framing
      if (p.stderr) {
        p.stderr.setEncoding("utf-8");
        let buf = "";
        p.stderr.on("data", (chunk: string) => {
          buf += chunk;
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              this.stderrBuf.push(line);
              this.emit("stderr", line);
            }
          }
        });
      }

      // Stdout — custom \n-only line parser
      if (p.stdout) {
        this.parser = parseLines(p.stdout, (line) => {
          this.onLine(line);
        }, this.maxLineBytes);
      }

      this.proc = p;
      this.setState("connected");
      resolveCb();
    });
  }

  async shutdown(): Promise<void> {
    this.setState("shutdown");

    // Reject pending requests
    for (const [, pen] of this.pending) {
      clearTimeout(pen.timer);
      pen.reject(new RpcDisconnectedError("Pi shutting down"));
    }
    this.pending.clear();

    if (this.parser) {
      this.parser.close();
      this.parser = null;
    }

    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
      await new Promise<void>((resolveCb) => {
        const t = setTimeout(() => {
          if (this.proc && !this.proc.killed) this.proc.kill("SIGKILL");
          resolveCb();
        }, 5000);
        this.proc?.on("exit", () => { clearTimeout(t); resolveCb(); });
      });
    }

    this.proc = null;
    this.setState("disconnected");
  }

  // ── Request / Response ────────────────────────────────────────────────

  async request(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    if (this.state !== "connected") throw new RpcDisconnectedError();

    const id = this.nextId();
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolveCb, rejectCb) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rejectCb(new RpcTimeoutError(id, timeout));
        }
      }, timeout);

      this.pending.set(id, { resolve: resolveCb, reject: rejectCb, timer });

      if (!this.proc?.stdin?.writable) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectCb(new RpcDisconnectedError("Pi stdin not writable"));
        return;
      }

      this.proc.stdin.write(JSON.stringify({ id, method, params }) + "\n", (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          rejectCb(new Error(`Failed to write RPC request: ${err.message}`));
        }
      });
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    if (this.state !== "connected") return;
    if (!this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify({ method, params }) + "\n");
  }

  // ── Accessors ─────────────────────────────────────────────────────────

  get currentState(): RpcState { return this.state; }
  get processPid(): number | null { return this.proc?.pid ?? null; }

  get recentStderr(): string[] {
    const lines = [...this.stderrBuf];
    this.stderrBuf = [];
    return lines;
  }

  get pendingCount(): number { return this.pending.size; }

  // ── Event emitter overloads ──────────────────────────────────────────

  on(event: "state", listener: (state: RpcState) => void): this;
  on(event: "event", listener: (event: RpcEvent) => void): this;
  on(event: "stderr", listener: (line: string) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private nextId(): RequestId {
    this.reqCounter += 1;
    return `rpc-${Date.now()}-${this.reqCounter}`;
  }

  private setState(newState: RpcState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit("state", newState);
    }
  }

  private onDisconnect(code: number | null, signal: NodeJS.Signals | null): void {
    const wasConnected = this.state === "connected";
    this.setState("disconnected");

    for (const [, pen] of this.pending) {
      clearTimeout(pen.timer);
      pen.reject(new RpcDisconnectedError(`Pi process exited (code=${code}, signal=${signal})`));
    }
    this.pending.clear();

    if (this.parser) {
      this.parser.close();
      this.parser = null;
    }

    if (wasConnected) this.setState("reconnecting");
  }

  private onLine(line: string): void {
    if (line.length > this.maxLineBytes) return;

    try {
      const msg = JSON.parse(line) as Record<string, unknown>;

      // Response (has id)
      if (msg.id && typeof msg.id === "string") {
        const pen = this.pending.get(msg.id);
        if (pen) {
          clearTimeout(pen.timer);
          this.pending.delete(msg.id);
          if (msg.error) {
            const e = msg.error as { code: number; message: string };
            pen.reject(Object.assign(new Error(`RPC error: ${e.message}`), {
              code: e.code,
              data: msg.data,
              rpcId: msg.id,
            }));
          } else {
            pen.resolve(msg.result);
          }
        }
      }
      // Event (has type, no id)
      else if (msg.type && typeof msg.type === "string") {
        this.emit("event", {
          type: msg.type,
          data: (msg.data as Record<string, unknown>) ?? {},
          timestamp: msg.timestamp as string | undefined,
        });
      }
    } catch {
      // Unparseable line
      this.emit("stderr", `RPC unparseable: ${line.slice(0, 200)}`);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function isRpcEvent(msg: RpcMessage): msg is RpcEvent {
  return "type" in msg && !("id" in msg);
}

export function isRpcError(msg: RpcMessage): msg is RpcError {
  return "id" in msg && "error" in msg;
}

export function isRpcResult(msg: RpcMessage): msg is RpcResult {
  return "id" in msg && "result" in msg && !("error" in msg);
}
