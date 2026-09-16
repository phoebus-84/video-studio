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

  private async read(file: string): Promise<LockFile | null> {
    try {
      return JSON.parse(await readFile(file, "utf-8")) as LockFile;
    } catch {
      return null;
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
      if (held && new Date(held.expiresAt).getTime() > this.now()) {
        return err({
          code: "LEASE_CONFLICT",
          message: `"${resource}" is held until ${held.expiresAt}`,
          resource,
        });
      }

      // Reclaim: remove the expired file and retry once. A loser of this race
      // finds the file present again and reports a conflict, which is correct —
      // someone did win it.
      try {
        await unlink(file);
      } catch { /* another reclaimer got there first */ }
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
    const file = this.fileFor(lease.resource);
    const held = await this.read(file);

    // Idempotent, and token-checked: a holder whose lease already expired must
    // not be able to release the lease that replaced it.
    if (!held || held.token !== lease.token) return ok(undefined);

    try {
      await unlink(file);
    } catch { /* already gone */ }
    return ok(undefined);
  }

  async renew(lease: Lease, ttlMs: number): Promise<Result<Lease, LockError>> {
    const file = this.fileFor(lease.resource);
    const held = await this.read(file);

    if (!held || held.token !== lease.token) {
      return err({
        code: "LEASE_LOST",
        message: `"${lease.resource}" is no longer held by this token`,
        resource: lease.resource,
      });
    }

    const renewed: LockFile = { ...held, expiresAt: new Date(this.now() + ttlMs).toISOString() };
    await writeFile(file, JSON.stringify(renewed));
    return ok({
      resource: lease.resource,
      token: renewed.token,
      expiresAt: new Date(renewed.expiresAt),
    });
  }
}
