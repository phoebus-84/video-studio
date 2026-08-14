/**
 * Minimal type for the spawn function signature used by the process runner.
 * Extracted to avoid circular imports.
 */

import type { ChildProcess } from "node:child_process";

export type SpawnFn = (
  command: string,
  args?: readonly string[],
  options?: Record<string, unknown>,
) => ChildProcess;
