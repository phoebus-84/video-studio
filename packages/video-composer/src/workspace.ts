/**
 * Temporary workspace lifecycle management.
 *
 * Creates isolated temporary directories under the OS temp directory.
 * Each workspace is a subdirectory with a unique name avoiding collisions.
 * Cleanup is explicit and recursive.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import type { Workspace } from "./types.js";
import { WorkspaceError } from "./types.js";

const PREFIX = "fvc-";

/**
 * Create a new temporary workspace directory.
 *
 * The workspace root is created under the OS temp directory with a unique
 * suffix. Call `cleanup()` on the returned workspace to remove it.
 */
export async function createWorkspace(): Promise<Workspace> {
  const template = join(tmpdir(), `${PREFIX}`);
  let root: string;

  try {
    root = await mkdtemp(template);
  } catch (err) {
    throw new WorkspaceError(
      `Failed to create workspace: ${err instanceof Error ? err.message : String(err)}`,
      { template },
    );
  }

  let cleaned = false;

  const ws: Workspace = {
    root,
    resolve(...segments: string[]): string {
      return resolvePath(root, ...segments);
    },
    async cleanup(): Promise<void> {
      if (cleaned) return;
      cleaned = true;
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 3 });
      } catch (err) {
        throw new WorkspaceError(
          `Failed to clean up workspace: ${err instanceof Error ? err.message : String(err)}`,
          { root },
        );
      }
    },
    get cleaned() {
      return cleaned;
    },
  };

  return ws;
}

/**
 * Create a nested sub-directory inside an existing workspace.
 * Returns the resolved absolute path without creating a new Workspace object.
 */
export function workspaceSubdir(
  workspace: Workspace,
  ...segments: string[]
): string {
  return workspace.resolve(...segments);
}
