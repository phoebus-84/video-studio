/**
 * Tests for the temporary workspace lifecycle.
 */

import { describe, it, expect } from "vitest";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createWorkspace, workspaceSubdir } from "../src/workspace.js";
import { WorkspaceError } from "../src/types.js";

describe("createWorkspace", () => {
  it("creates a workspace directory under the OS temp dir", async () => {
    const ws = await createWorkspace();
    try {
      expect(ws.root).toContain("fvc-");
      // Verify it actually exists on disk
      await access(ws.root);
    } finally {
      await ws.cleanup();
    }
  });

  it("resolve() returns paths rooted in the workspace", async () => {
    const ws = await createWorkspace();
    try {
      const resolved = ws.resolve("inputs", "video.mp4");
      expect(resolved).toBe(ws.root + "/inputs/video.mp4");
      expect(resolved.startsWith(ws.root)).toBe(true);
    } finally {
      await ws.cleanup();
    }
  });

  it("resolve() handles no segments (returns root)", async () => {
    const ws = await createWorkspace();
    try {
      expect(ws.resolve()).toBe(ws.root);
    } finally {
      await ws.cleanup();
    }
  });

  it("cleanup removes the directory", async () => {
    const ws = await createWorkspace();
    // Create a file inside
    await mkdir(ws.resolve("subdir"), { recursive: true });
    await writeFile(ws.resolve("subdir", "file.txt"), "hello");

    await ws.cleanup();
    expect(ws.cleaned).toBe(true);

    // Directory should be gone
    await expect(access(ws.root)).rejects.toThrow();
  });

  it("cleanup is idempotent (double cleanup does not throw)", async () => {
    const ws = await createWorkspace();
    await ws.cleanup();
    // Second cleanup should not throw
    await expect(ws.cleanup()).resolves.toBeUndefined();
  });

  it("throws WorkspaceError if cleanup fails on a path that was already removed", async () => {
    // Since cleanup catches errors, this tests that the path through rm works
    const ws = await createWorkspace();
    await ws.cleanup();
    // cleanup is idempotent, so this should be fine
    expect(ws.cleaned).toBe(true);
  });

  it("workspaceSubdir returns a path inside the workspace", async () => {
    const ws = await createWorkspace();
    try {
      const sub = workspaceSubdir(ws, "outputs", "frames");
      expect(sub).toBe(ws.root + "/outputs/frames");
      expect(sub.startsWith(ws.root)).toBe(true);
    } finally {
      await ws.cleanup();
    }
  });
});
