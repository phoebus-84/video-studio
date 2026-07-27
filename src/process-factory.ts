/**
 * Process factory — injectable spawn for testing.
 *
 * The process-runner uses this factory to spawn child processes.
 * Tests can replace the factory with a fake implementation that
 * returns pre-configured responses without executing real binaries.
 */

import { spawn as _realSpawn } from "node:child_process";
import type { SpawnFn } from "./process-factory-types.js";

/**
 * The active spawn function. Tests swap this for a fake.
 */
let currentSpawn: SpawnFn = _realSpawn as unknown as SpawnFn;

export function getSpawn(): SpawnFn {
  return currentSpawn;
}

/**
 * Replace the spawn function (for testing).
 * Returns a restore function.
 */
export function setSpawn(fn: SpawnFn): () => void {
  const prev = currentSpawn;
  currentSpawn = fn;
  return () => {
    currentSpawn = prev;
  };
}
