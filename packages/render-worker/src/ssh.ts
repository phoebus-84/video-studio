// One command on an engine over SSH: arguments in, stdin streamed, stdout
// collected (or streamed to a file), stderr handed over line by line. The
// rest of the package talks to an `Exec`, so tests run the engine in-process.

import { spawn } from "node:child_process";
import { Readable, type Writable } from "node:stream";
import { RenderWorkerError } from "./protocol.js";

export interface ExecInput {
  /** Bytes for the command's stdin; closed at once when absent. */
  stdin?: string | Buffer | AsyncIterable<Buffer>;
  /** Where stdout goes; collected into `stdout` when absent. */
  stdout?: Writable;
  onStderrLine?: (line: string) => void;
  signal?: AbortSignal;
}

export interface ExecResult {
  code: number;
  stdout: string;
  /** The last stderr lines, for error messages. */
  stderr: string;
}

/** Runs `command` (a shell command line) on `destination` ([user@]address). */
export type Exec = (destination: string, command: string, input?: ExecInput) => Promise<ExecResult>;

export interface SshOptions {
  /** The ssh program: AVG_RENDER_SSH, else "ssh" on PATH. */
  program?: string;
  connectTimeoutSeconds?: number;
}

/** ssh's own exit code when it could not connect or authenticate. */
export const SSH_FAILED = 255;

export function sshArgs(destination: string, command: string, options: SshOptions = {}): string[] {
  return [
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${options.connectTimeoutSeconds ?? 10}`,
    "-o", "ServerAliveInterval=30",
    "--", destination, command,
  ];
}

export function sshExec(options: SshOptions = {}): Exec {
  const program = options.program ?? process.env.AVG_RENDER_SSH ?? "ssh";
  return (destination, command, input = {}) => new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(program, sshArgs(destination, command, options), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const out: Buffer[] = [];
    const tail: string[] = [];
    let partial = "";
    const line = (text: string) => {
      tail.push(text);
      if (tail.length > 40) tail.shift();
      input.onStderrLine?.(text);
    };
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => {
      const lines = (partial + chunk).split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const l of lines) line(l);
    });
    if (input.stdout) child.stdout.pipe(input.stdout);
    else child.stdout.on("data", (b: Buffer) => out.push(b));
    child.on("error", (e) => reject(new RenderWorkerError("no-engine", `${program} could not run: ${e.message}`)));
    let written: Promise<void> = Promise.resolve();
    if (input.stdout) {
      const sink = input.stdout;
      written = new Promise((done, fail) => {
        child.stdout.on("end", () => sink.end());
        sink.on("finish", () => done());
        sink.on("error", fail);
      });
    }
    let fed: unknown = null;
    child.on("close", (code) => {
      if (partial) line(partial);
      if (fed) return reject(fed);
      written.then(() => resolve({ code: code ?? SSH_FAILED, stdout: Buffer.concat(out).toString("utf-8"), stderr: tail.join("\n") }), reject);
    });
    child.stdin.on("error", () => undefined); // the remote side may close early; its exit code says why
    feed(input.stdin, child.stdin).catch((e: unknown) => {
      fed = e;
      child.stdin.destroy();
    });
  });
}

async function feed(data: ExecInput["stdin"], stdin: Writable): Promise<void> {
  if (data === undefined) return void stdin.end();
  if (typeof data === "string" || Buffer.isBuffer(data)) return void stdin.end(data);
  const source = Readable.from(data);
  await new Promise<void>((done, fail) => {
    source.on("error", fail);
    stdin.on("finish", done);
    source.pipe(stdin);
  });
}

/** A word for a remote POSIX shell: single-quoted unless plainly safe. */
export function shellQuote(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** A remote path, quoted, with a leading "~/" left for the shell to expand. */
export function shellPath(path: string): string {
  if (path === "~") return "~";
  if (path.startsWith("~/")) return `~/${shellQuote(path.slice(2))}`;
  return shellQuote(path);
}
