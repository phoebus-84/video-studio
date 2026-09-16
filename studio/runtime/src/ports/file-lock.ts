// ---------------------------------------------------------------------------
// Filesystem lock
// ---------------------------------------------------------------------------
// The Lock port has existed since the runtime was written, with no
// implementation but a test fixture — so nothing in the project could actually
// arbitrate a race.
//
// An append-only journal can record that a lease was granted. It cannot decide
// who won: two processes would both append stage-leased and both believe they
// hold the stage. The gateway, the CLI and the agent genuinely run
// concurrently on one machine, so that race is real.
//
// `wx` is the arbitration. The filesystem decides, not the caller.
//
// Per-machine by construction. A distributed lock is a different problem and
// this must not pretend to solve it.
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { ok, err, type Result } from "../result.js";
import type { Lock, Lease, LockError } from "./lock.js";

interface LockFile {
  token: string;
  expiresAt: string;
  resource: string;
}

export class FileLock implements Lock {
  constructor(
    private readonly rootDir: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** One file per resource. The name is derived, never the caller's string. */
  private fileFor(resource: string): string {
    const safe = Buffer.from(resource).toString("base64url");
    return path.join(this.rootDir, `${safe}.lock`);
  }

  /**
   * Distinguishes "no lockfile" from "a lockfile that can't be trusted".
   *
   * ENOENT means the resource is genuinely free. Anything else — an
   * unreadable file, or one that parses to something other than a well-formed
   * `LockFile` — is what a crash mid-write leaves behind, and its holder may
   * still be running. Callers must fail closed on `"malformed"`, not treat it
   * as `"missing"`.
   */
  private async read(
    file: string,
  ): Promise<{ kind: "missing" } | { kind: "malformed" } | { kind: "ok"; value: LockFile }> {
    let raw: string;
    try {
      raw = await readFile(file, "utf-8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      return { kind: "malformed" };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<LockFile>;
      if (
        typeof parsed.token === "string" &&
        typeof parsed.expiresAt === "string" &&
        typeof parsed.resource === "string"
      ) {
        return { kind: "ok", value: parsed as LockFile };
      }
      return { kind: "malformed" };
    } catch {
      return { kind: "malformed" };
    }
  }

  async acquire(resource: string, ttlMs: number): Promise<Result<Lease, LockError>> {
    const file = this.fileFor(resource);
    await mkdir(this.rootDir, { recursive: true });

    const lease: LockFile = {
      token: randomUUID(),
      expiresAt: new Date(this.now() + ttlMs).toISOString(),
      resource,
    };

    try {
      // `wx` fails if the file exists. This is the arbitration.
      await writeFile(file, JSON.stringify(lease), { flag: "wx" });
      return ok({ resource, token: lease.token, expiresAt: new Date(lease.expiresAt) });
    } catch {
      // Held — unless whoever held it is past their expiry.
      const held = await this.read(file);

      if (held.kind === "malformed") {
        // Unreadable, or partial JSON — exactly what a crash mid-write
        // leaves behind. We cannot tell whether its holder is still running,
        // so we must not reclaim it. Failing closed here means refusing to
        // run a stage that could safely have run (recoverable); the
        // alternative is a stage that runs twice (not recoverable).
        return err({
          code: "LEASE_CONFLICT",
          message: `"${resource}" has an unreadable lockfile and cannot be verified as free`,
          resource,
        });
      }

      if (held.kind === "ok" && new Date(held.value.expiresAt).getTime() > this.now()) {
        return err({
          code: "LEASE_CONFLICT",
          message: `"${resource}" is held until ${held.value.expiresAt}`,
          resource,
        });
      }

      // Reclaim: remove the expired (or now-missing) file and retry once. A
      // loser of this race finds the file present again and reports a
      // conflict, which is correct — someone did win it.
      try {
        await unlink(file);
      } catch { /* another reclaimer got there first, or it was already gone */ }
      try {
        await writeFile(file, JSON.stringify(lease), { flag: "wx" });
        return ok({ resource, token: lease.token, expiresAt: new Date(lease.expiresAt) });
      } catch {
        return err({
          code: "LEASE_CONFLICT",
          message: `"${resource}" was taken while reclaiming an expired lease`,
          resource,
        });
      }
    }
  }

  async release(lease: Lease): Promise<Result<void, LockError>> {
    // An expired lease is not a lease: reject it before touching the file at
    // all, rather than reading the file, deciding it's ours, and unlinking a
    // moment later. That gap is exactly where a reclaimer's write could land
    // — this caller's stale token would then delete the NEW holder's file.
    // A lease that is still valid *here* cannot have been reclaimed, because
    // reclaim only ever targets an already-expired lockfile — so the file
    // cannot change out from under a still-valid caller between this check
    // and the unlink below. `release` is documented as idempotent even for
    // an expired lease, so this is success, not an error.
    //
    // A microsecond-scale window remains: the lease could expire between this
    // check and the unlink a few lines down. That's acceptable — TTLs here
    // are minutes, not microseconds — and closing it fully would mean a lock
    // for the lockfile, which is the thing we are refusing to build.
    if (lease.expiresAt.getTime() <= this.now()) return ok(undefined);

    const file = this.fileFor(lease.resource);
    const held = await this.read(file);

    // Idempotent, and token-checked: a holder whose lease already expired (or
    // whose lockfile is unreadable) must not be able to release the lease
    // that replaced it.
    if (held.kind !== "ok" || held.value.token !== lease.token) return ok(undefined);

    try {
      await unlink(file);
    } catch { /* already gone */ }
    return ok(undefined);
  }

  async renew(lease: Lease, ttlMs: number): Promise<Result<Lease, LockError>> {
    // Same reasoning as release: reject an expired caller-side lease up
    // front, before the file is touched, to close the TOCTOU window. See the
    // comment in release() for the residual (microsecond-scale) window that
    // is accepted rather than solved with a lock for the lockfile.
    if (lease.expiresAt.getTime() <= this.now()) {
      return err({
        code: "LEASE_EXPIRED",
        message: `"${lease.resource}" lease has expired`,
        resource: lease.resource,
      });
    }

    const file = this.fileFor(lease.resource);
    const held = await this.read(file);

    if (
      held.kind !== "ok" ||
      held.value.token !== lease.token ||
      new Date(held.value.expiresAt).getTime() <= this.now()
    ) {
      return err({
        code: "LEASE_EXPIRED",
        message: `"${lease.resource}" is no longer held by this token`,
        resource: lease.resource,
      });
    }

    const renewed: LockFile = {
      ...held.value,
      expiresAt: new Date(this.now() + ttlMs).toISOString(),
    };
    await writeFile(file, JSON.stringify(renewed));
    return ok({
      resource: lease.resource,
      token: renewed.token,
      expiresAt: new Date(renewed.expiresAt),
    });
  }
}
