// ---------------------------------------------------------------------------
// Test fixtures and helpers
//
// Reusable fakes for every port so tests need no concrete providers.
// Exported as a sub-path (./test-fixtures) for integration tests in sibling
// packages.
// ---------------------------------------------------------------------------

import type {
  Clock,
  FileSystem,
  FsError,
  Lock,
  Lease,
  LockError,
  IdGenerator,
  EventSink,
  EventSinkError,
  Event,
  Logger,
  LogLevel,
} from "../../src/index.js";
import { ok, err, RuntimeError, ErrorCode, isOk, isErr, map, mapErr, andThen, unwrapOr, unwrap } from "../../src/index.js";
import type { Result } from "../../src/index.js";

// ---- FakeClock -------------------------------------------------------------

export class FakeClock implements Clock {
  private current: number;

  /** @param startMs ISO timestamp to begin at.  Default: 2024-01-01T00:00:00Z */
  constructor(startMs?: number) {
    this.current = startMs ?? new Date("2024-01-01T00:00:00Z").getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  nowMs(): number {
    return this.current;
  }

  async sleep(ms: number): Promise<void> {
    // Deterministic: just advance time without real waiting.
    this.current += ms;
  }

  /** Manually advance time. */
  advance(ms: number): void {
    this.current += ms;
  }

  /** Set time to an explicit value. */
  set(ms: number): void {
    this.current = ms;
  }
}

// ---- FakeFileSystem --------------------------------------------------------

export class FakeFileSystem implements FileSystem {
  private readonly store = new Map<string, string>();
  /** Directories explicitly created. */
  private readonly dirs = new Set<string>();

  // -- helpers for tests --

  /** Seed a fresh store from a plain object. */
  seed(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      this.store.set(this.normalise(path), content);
      // implicit parent dirs
      const parent = this.parent(path);
      if (parent) this.dirs.add(parent);
    }
  }

  getStoreSnapshot(): ReadonlyMap<string, string> {
    return new Map(this.store);
  }

  private normalise(p: string): string {
    return p.replace(/\\/g, "/");
  }

  private parent(p: string): string {
    const segments = this.normalise(p).split("/");
    segments.pop();
    return segments.join("/");
  }

  private error(
    code: string,
    message: string,
    path: string,
    syscall?: string,
  ): FsError {
    return { code, message, path, syscall };
  }

  async readText(path: string): Promise<Result<string, FsError>> {
    const np = this.normalise(path);
    if (!this.store.has(np)) {
      return err(this.error("ENOENT", `File not found: ${np}`, np, "read"));
    }
    return ok(this.store.get(np)!);
  }

  async writeText(path: string, content: string): Promise<Result<void, FsError>> {
    const np = this.normalise(path);
    const parent = this.parent(np);
    if (parent && !this.dirs.has(parent)) {
      return err(
        this.error("ENOENT", `Parent directory missing: ${parent}`, np, "write"),
      );
    }
    this.store.set(np, content);
    return ok(undefined);
  }

  async mkdir(
    path: string,
    recursive = false,
  ): Promise<Result<void, FsError>> {
    const np = this.normalise(path);
    if (recursive) {
      // Create all ancestors.
      const parts = np.split("/");
      for (let i = 1; i <= parts.length; i++) {
        this.dirs.add(parts.slice(0, i).join("/"));
      }
      return ok(undefined);
    }
    const parent = this.parent(np);
    if (parent && !this.dirs.has(parent)) {
      return err(
        this.error("ENOENT", `Parent directory missing: ${parent}`, np, "mkdir"),
      );
    }
    this.dirs.add(np);
    return ok(undefined);
  }

  async exists(path: string): Promise<Result<boolean, FsError>> {
    const np = this.normalise(path);
    return ok(this.store.has(np) || this.dirs.has(np));
  }

  async readDir(path: string): Promise<Result<string[], FsError>> {
    const np = this.normalise(path);
    if (!this.dirs.has(np)) {
      return err(
        this.error("ENOENT", `Directory not found: ${np}`, np, "readdir"),
      );
    }
    const prefix = np === "." ? "" : `${np}/`;
    const children = new Set<string>();
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        const relative = key.slice(prefix.length).split("/")[0]!;
        children.add(relative);
      }
    }
    for (const dir of this.dirs) {
      if (
        dir !== np &&
        dir.startsWith(prefix) &&
        !dir.slice(prefix.length).includes("/")
      ) {
        children.add(dir.slice(prefix.length));
      }
    }
    return ok([...children].sort());
  }

  async remove(path: string): Promise<Result<void, FsError>> {
    const np = this.normalise(path);
    this.store.delete(np);
    return ok(undefined);
  }

  async removeDir(path: string): Promise<Result<void, FsError>> {
    const np = this.normalise(path);
    const prefix = `${np}/`;
    for (const key of [...this.store.keys()]) {
      if (key === np || key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
    for (const dir of [...this.dirs]) {
      if (dir === np || dir.startsWith(prefix)) {
        this.dirs.delete(dir);
      }
    }
    return ok(undefined);
  }

  async atomicWrite(
    path: string,
    content: string,
  ): Promise<Result<void, FsError>> {
    // In-memory equivalent: write is atomic within the same tick.
    return this.writeText(path, content);
  }

  async stat(
    path: string,
  ): Promise<Result<{ isDirectory: boolean; size: number }, FsError>> {
    const np = this.normalise(path);
    if (this.dirs.has(np)) {
      return ok({ isDirectory: true, size: 0 });
    }
    if (this.store.has(np)) {
      return ok({ isDirectory: false, size: this.store.get(np)!.length });
    }
    return err(this.error("ENOENT", `File not found: ${np}`, np, "stat"));
  }
}

// ---- FakeLock --------------------------------------------------------------

export class FakeLock implements Lock {
  private readonly leases = new Map<string, Lease>();

  async acquire(
    resource: string,
    ttlMs: number,
  ): Promise<Result<Lease, LockError>> {
    const existing = this.leases.get(resource);
    if (existing && existing.expiresAt.getTime() > Date.now()) {
      return err({
        code: "LEASE_CONFLICT",
        message: `Resource ${resource} is locked`,
        resource,
      });
    }
    const token = `token-${resource}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lease: Lease = {
      resource,
      token,
      expiresAt: new Date(Date.now() + ttlMs),
    };
    this.leases.set(resource, lease);
    return ok(lease);
  }

  async release(lease: Lease): Promise<Result<void, LockError>> {
    const existing = this.leases.get(lease.resource);
    if (existing && existing.token === lease.token) {
      this.leases.delete(lease.resource);
    }
    // Idempotent: release of unknown lease is a no-op.
    return ok(undefined);
  }

  async renew(
    lease: Lease,
    ttlMs: number,
  ): Promise<Result<Lease, LockError>> {
    const existing = this.leases.get(lease.resource);
    if (!existing || existing.token !== lease.token) {
      return err({
        code: "LEASE_EXPIRED",
        message: `Lease for ${lease.resource} is expired or unknown`,
        resource: lease.resource,
      });
    }
    const renewed: Lease = {
      ...existing,
      expiresAt: new Date(Date.now() + ttlMs),
    };
    this.leases.set(lease.resource, renewed);
    return ok(renewed);
  }

  /** Inspect active leases (for test assertions). */
  activeCount(): number {
    return this.leases.size;
  }

  hasLease(resource: string): boolean {
    const l = this.leases.get(resource);
    return !!l && l.expiresAt.getTime() > Date.now();
  }
}

// ---- FakeIdGenerator -------------------------------------------------------

export class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  private readonly prefix: string;

  constructor(prefix = "id") {
    this.prefix = prefix;
  }

  generate(): string {
    const id = `${this.prefix}_${String(this.counter).padStart(6, "0")}`;
    this.counter++;
    return id;
  }

  generateShort(): string {
    return this.generate().slice(0, 8);
  }
}

// ---- FakeEventSink ---------------------------------------------------------

export class FakeEventSink implements EventSink {
  public readonly events: Event[] = [];

  async append(
    event: Omit<Event, "timestamp" | "eventId">,
  ): Promise<Result<Event, EventSinkError>> {
    const full = {
      timestamp: new Date().toISOString(),
      eventId: `evt_${this.events.length}`,
      ...event,
    } as Event;
    this.events.push(full);
    return ok(full);
  }

  async appendAll(
    events: Omit<Event, "timestamp" | "eventId">[],
  ): Promise<Result<Event[], EventSinkError>> {
    const results: Event[] = [];
    for (const e of events) {
      const r = await this.append(e);
      if (r.ok) results.push(r.value);
      else return err(r.error);
    }
    return ok(results);
  }

  /** Number of events appended. */
  count(): number {
    return this.events.length;
  }

  /** Clear accumulated events. */
  clear(): void {
    this.events.length = 0;
  }
}

// ---- SpyLogger -------------------------------------------------------------

export class SpyLogger implements Logger {
  public readonly calls: {
    level: LogLevel;
    message: string;
    meta?: Record<string, unknown>;
  }[] = [];

  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    this.calls.push({ level, message, meta });
  }
  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }

  /** Filter calls by level. */
  ofLevel(level: LogLevel): { message: string; meta?: Record<string, unknown> }[] {
    return this.calls.filter((c) => c.level === level);
  }

  clear(): void {
    this.calls.length = 0;
  }
}

// Re-export for direct access from the fixtures barrel
export { RuntimeError, ErrorCode };
export { ok, err, isOk, isErr, map, mapErr, andThen, unwrapOr, unwrap };
export type { Result, Event };
