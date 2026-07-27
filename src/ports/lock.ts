// ---------------------------------------------------------------------------
// Lock port
//
// Leases prevent concurrent mutations to canonical filesystem records.
// The lock interface abstracts the underlying mechanism (in-process,
// file-based, or distributed) so tests and production use the same protocol.
// ---------------------------------------------------------------------------

import type { Result } from "../result.js";

/**
 * A granted lease.
 *
 * The `token` is opaque to callers; it certifies ownership during release
 * and renewal.
 */
export interface Lease {
  readonly resource: string;
  readonly token: string;
  readonly expiresAt: Date;
}

/** Error shape for lock operations. */
export interface LockError {
  code: string;
  message: string;
  resource: string;
}

export interface Lock {
  /**
   * Acquire an exclusive lease on `resource`.
   *
   * Returns `LEASE_CONFLICT` if the resource is already held by another
   * lease.  The lease auto-expires after `ttlMs` unless renewed.
   */
  acquire(resource: string, ttlMs: number): Promise<Result<Lease, LockError>>;

  /**
   * Release a lease so another party may acquire the resource.
   * Safe to call with an expired or unknown lease (idempotent).
   */
  release(lease: Lease): Promise<Result<void, LockError>>;

  /**
   * Extend a lease's TTL.  Returns a new `Lease` with a refreshed
   * `expiresAt`.  Fails with `LEASE_EXPIRED` if the lease has expired or
   * was already released.
   */
  renew(lease: Lease, ttlMs: number): Promise<Result<Lease, LockError>>;
}
