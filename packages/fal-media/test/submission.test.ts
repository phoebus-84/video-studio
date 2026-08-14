// ---------------------------------------------------------------------------
// Submission and idempotency tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryIdempotencyStore, FileSystemIdempotencyStore } from "../src/submission.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ── Idempotency store tests ─────────────────────────────────────────────────

describe("InMemoryIdempotencyStore", () => {
  let store: InMemoryIdempotencyStore;

  beforeEach(() => {
    store = new InMemoryIdempotencyStore();
  });

  it("returns null for unknown key", async () => {
    expect(await store.get("unknown")).toBeNull();
  });

  it("stores and retrieves", async () => {
    await store.set("key-1", "job-123");
    expect(await store.get("key-1")).toBe("job-123");
  });

  it("deletes entries", async () => {
    await store.set("key-1", "job-123");
    await store.delete("key-1");
    expect(await store.get("key-1")).toBeNull();
  });

  it("tracks size", async () => {
    expect(store.size).toBe(0);
    await store.set("a", "1");
    await store.set("b", "2");
    expect(store.size).toBe(2);
  });
});

describe("FileSystemIdempotencyStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `fal-idem-test-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    try { await fs.rm(dir, { recursive: true }); } catch {}
  });

  it("stores and retrieves from filesystem", async () => {
    const store = new FileSystemIdempotencyStore(dir);
    await store.set("my-key", "job-456");
    expect(await store.get("my-key")).toBe("job-456");
  });

  it("returns null for missing key", async () => {
    const store = new FileSystemIdempotencyStore(dir);
    expect(await store.get("missing")).toBeNull();
  });

  it("deletes entries", async () => {
    const store = new FileSystemIdempotencyStore(dir);
    await store.set("del-me", "job-789");
    await store.delete("del-me");
    expect(await store.get("del-me")).toBeNull();
  });

  it("handles special characters in keys", async () => {
    const store = new FileSystemIdempotencyStore(dir);
    await store.set("key/with/slashes", "job-001");
    expect(await store.get("key/with/slashes")).toBe("job-001");
  });
});
