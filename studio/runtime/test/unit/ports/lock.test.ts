import { describe, it, expect } from "vitest";
import { FakeLock } from "../../fixtures/index.js";
import { isOk, isErr } from "../../../src/result.js";

describe("Lock port via FakeLock", () => {
  describe("acquire", () => {
    it("grants a lease for a free resource", async () => {
      const lock = new FakeLock();
      const r = await lock.acquire("stage-1", 60_000);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value.resource).toBe("stage-1");
        expect(r.value.token).toBeTruthy();
        expect(r.value.expiresAt.getTime()).toBeGreaterThan(Date.now());
      }
    });

    it("rejects a second acquisition of the same resource", async () => {
      const lock = new FakeLock();
      await lock.acquire("stage-1", 60_000);
      const r = await lock.acquire("stage-1", 60_000);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.code).toBe("LEASE_CONFLICT");
      }
    });

    it("grants different resources concurrently", async () => {
      const lock = new FakeLock();
      const a = await lock.acquire("s1", 60_000);
      const b = await lock.acquire("s2", 60_000);
      expect(isOk(a)).toBe(true);
      expect(isOk(b)).toBe(true);
    });
  });

  describe("release", () => {
    it("releases a held lease", async () => {
      const lock = new FakeLock();
      const r = await lock.acquire("s1", 60_000);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        await lock.release(r.value);
        const r2 = await lock.acquire("s1", 60_000);
        expect(isOk(r2)).toBe(true);
      }
    });

    it("is idempotent for unknown leases", async () => {
      const lock = new FakeLock();
      const result = await lock.release({
        resource: "ghost",
        token: "no-such-token",
        expiresAt: new Date(),
      });
      expect(isOk(result)).toBe(true);
    });

    it("does not release a lease held by a different token", async () => {
      const lock = new FakeLock();
      const r = await lock.acquire("s1", 60_000);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        await lock.release({
          resource: "s1",
          token: "wrong-token",
          expiresAt: r.value.expiresAt,
        });
        const r2 = await lock.acquire("s1", 60_000);
        expect(isErr(r2)).toBe(true);
      }
    });
  });

  describe("renew", () => {
    it("extends the lease TTL", async () => {
      const lock = new FakeLock();
      const r = await lock.acquire("s1", 60_000);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        const originalExpiry = r.value.expiresAt.getTime();
        const renewed = await lock.renew(r.value, 120_000);
        expect(isOk(renewed)).toBe(true);
        if (isOk(renewed)) {
          expect(renewed.value.expiresAt.getTime()).toBeGreaterThan(
            originalExpiry,
          );
        }
      }
    });

    it("fails for an unknown token", async () => {
      const lock = new FakeLock();
      const r = await lock.renew(
        { resource: "ghost", token: "bad", expiresAt: new Date() },
        60_000,
      );
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.code).toBe("LEASE_EXPIRED");
      }
    });
  });

  describe("activeCount / hasLease", () => {
    it("tracks active leases", async () => {
      const lock = new FakeLock();
      expect(lock.activeCount()).toBe(0);
      await lock.acquire("a", 60_000);
      await lock.acquire("b", 60_000);
      expect(lock.activeCount()).toBe(2);
      expect(lock.hasLease("a")).toBe(true);
      expect(lock.hasLease("c")).toBe(false);
    });
  });
});
