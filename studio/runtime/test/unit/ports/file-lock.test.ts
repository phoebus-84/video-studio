import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLock } from "../../../src/ports/file-lock.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function lockRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "file-lock-"));
  roots.push(root);
  return root;
}

describe("FileLock", () => {
  it("grants a lease on a free resource", async () => {
    const lock = new FileLock(await lockRoot());
    const got = await lock.acquire("stage:illustrations", 60_000);

    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value.resource).toBe("stage:illustrations");
      expect(got.value.token).toMatch(/\S/);
      expect(got.value.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("refuses a resource someone else holds", async () => {
    const lock = new FileLock(await lockRoot());
    await lock.acquire("stage:illustrations", 60_000);

    const second = await lock.acquire("stage:illustrations", 60_000);

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("LEASE_CONFLICT");
  });

  it("lets exactly one of many concurrent acquirers win", async () => {
    // This is the whole point: the filesystem arbitrates, not the caller.
    const lock = new FileLock(await lockRoot());
    const results = await Promise.all(
      Array.from({ length: 12 }, () => lock.acquire("stage:illustrations", 60_000)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("reclaims a lease whose expiry has passed", async () => {
    const lock = new FileLock(await lockRoot());
    const first = await lock.acquire("stage:illustrations", 1);
    expect(first.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 20));

    const second = await lock.acquire("stage:illustrations", 60_000);
    expect(second.ok).toBe(true);
  });

  it("does not let a stale token release the current holder", async () => {
    const lock = new FileLock(await lockRoot());
    const first = await lock.acquire("stage:illustrations", 1);
    if (!first.ok) throw new Error("setup failed");
    await new Promise((r) => setTimeout(r, 20));
    const second = await lock.acquire("stage:illustrations", 60_000);
    if (!second.ok) throw new Error("setup failed");

    // The first holder wakes up late and tries to tidy up.
    await lock.release(first.value);

    // The second holder must still hold it.
    const third = await lock.acquire("stage:illustrations", 60_000);
    expect(third.ok).toBe(false);
  });

  it("releases idempotently", async () => {
    const lock = new FileLock(await lockRoot());
    const got = await lock.acquire("stage:illustrations", 60_000);
    if (!got.ok) throw new Error("setup failed");

    expect((await lock.release(got.value)).ok).toBe(true);
    expect((await lock.release(got.value)).ok).toBe(true);
    expect((await lock.acquire("stage:illustrations", 60_000)).ok).toBe(true);
  });

  it("renews only for the token that holds the lease", async () => {
    const lock = new FileLock(await lockRoot());
    const got = await lock.acquire("stage:illustrations", 60_000);
    if (!got.ok) throw new Error("setup failed");

    const renewed = await lock.renew(got.value, 120_000);
    expect(renewed.ok).toBe(true);
    if (renewed.ok) {
      expect(renewed.value.expiresAt.getTime()).toBeGreaterThan(got.value.expiresAt.getTime());
    }

    const impostor = { ...got.value, token: "not-the-token" };
    expect((await lock.renew(impostor, 120_000)).ok).toBe(false);
  });

  it("keeps separate resources independent", async () => {
    const lock = new FileLock(await lockRoot());
    expect((await lock.acquire("stage:illustrations", 60_000)).ok).toBe(true);
    expect((await lock.acquire("stage:captions", 60_000)).ok).toBe(true);
  });

  it("release with an expired lease succeeds without touching the current holder's file", async () => {
    const lock = new FileLock(await lockRoot());
    const first = await lock.acquire("stage:illustrations", 1);
    if (!first.ok) throw new Error("setup failed");
    await new Promise((r) => setTimeout(r, 20));
    const second = await lock.acquire("stage:illustrations", 60_000);
    if (!second.ok) throw new Error("setup failed");

    // The first holder wakes up long after expiry and tries to release. This
    // must succeed (release is idempotent, even for an expired lease) but
    // must not touch the file the second holder now owns.
    const released = await lock.release(first.value);
    expect(released.ok).toBe(true);

    // Proof the second holder's file was never touched: it can still be
    // renewed with its own token.
    const renewed = await lock.renew(second.value, 60_000);
    expect(renewed.ok).toBe(true);
  });

  it("fails to renew an expired lease with LEASE_EXPIRED", async () => {
    const lock = new FileLock(await lockRoot());
    const first = await lock.acquire("stage:illustrations", 1);
    if (!first.ok) throw new Error("setup failed");
    await new Promise((r) => setTimeout(r, 20));

    const renewed = await lock.renew(first.value, 60_000);
    expect(renewed.ok).toBe(false);
    if (!renewed.ok) expect(renewed.error.code).toBe("LEASE_EXPIRED");
  });

  it("refuses to acquire a resource whose lockfile is malformed", async () => {
    const root = await lockRoot();
    const resource = "stage:illustrations";
    const file = join(root, `${Buffer.from(resource).toString("base64url")}.lock`);
    // What a crash mid-write leaves behind: present, but not valid JSON.
    await writeFile(file, "{not valid json", "utf-8");

    const lock = new FileLock(root);
    const got = await lock.acquire(resource, 60_000);

    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error.code).toBe("LEASE_CONFLICT");
  });

  it("refuses to acquire a resource whose lockfile has an unreadable expiry", async () => {
    const root = await lockRoot();
    const resource = "stage:illustrations";
    const file = join(root, `${Buffer.from(resource).toString("base64url")}.lock`);
    // Structurally a lockfile -- three strings -- but the expiry is not a
    // date. The old check was `typeof expiresAt === "string"` and nothing
    // more, so this read as `ok`; then `new Date("whenever").getTime()` is
    // NaN, `NaN > now` is false, and the lockfile was reclaimed out from
    // under a holder that may still be running. An expiry we cannot read
    // says nothing about whether its holder is alive, so it fails closed.
    await writeFile(file, JSON.stringify({
      token: "t1", expiresAt: "whenever", resource,
    }), "utf-8");

    const lock = new FileLock(root);
    const got = await lock.acquire(resource, 60_000);

    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error.code).toBe("LEASE_CONFLICT");
  });
});
