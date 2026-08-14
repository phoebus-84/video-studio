// ---------------------------------------------------------------------------
// Artifact store tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  ArtifactStore,
  ArtifactConflictError,
  computeRevisionId,
} from "../../../src/artifacts/index.js";
import type { ArtifactRead } from "../../../src/artifacts/types.js";
import { FakeFileSystem } from "../../fixtures/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(fs = new FakeFileSystem(), author = "test-runner") {
  // Pre-create parent directories for test paths
  fs.seed({ "/test/.keep": "" });
  return new ArtifactStore(fs, { author });
}

async function initArtifact(
  store: ArtifactStore,
  path: string,
  content: string,
): Promise<string> {
  const result = await store.create(path, content);
  if (!result.ok) throw new Error(`Failed to create: ${result.error}`);
  return result.value.revisionId;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ArtifactStore", () => {
  let store: ArtifactStore;

  beforeEach(() => {
    store = makeStore();
  });

  describe("create", () => {
    it("creates a new artifact with revision 0 → write", async () => {
      const result = await store.create("/test/script.md", "# Hello");
      expect(result.ok).toBe(true);
      expect(result.value!.written).toBe(true);
      expect(result.value!.revisionId).toBeDefined();
    });

    it("rejects creation if file already exists", async () => {
      await store.create("/test/script.md", "# First");
      const result = await store.create("/test/script.md", "# Second");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already exists");
      }
    });
  });

  describe("read", () => {
    it("reads existing artifact with revision and history", async () => {
      await store.create("/test/doc.md", "# Document");
      const result = await store.read("/test/doc.md");

      expect(result.ok).toBe(true);
      const read: ArtifactRead = result.value!;
      expect(read.content).toBe("# Document");
      expect(read.revisionId).toBeDefined();
      expect(read.history.length).toBe(1);
      expect(read.history[0]!.author).toBe("test-runner");
    });

    it("returns error for missing file", async () => {
      const result = await store.read("/nonexistent.md");
      expect(result.ok).toBe(false);
    });
  });

  describe("compare-and-swap write", () => {
    it("succeeds when revision matches", async () => {
      const rev = await initArtifact(store, "/test/file.md", "v1");
      const result = await store.write("/test/file.md", "v2", rev, "Update to v2");

      expect(result.ok).toBe(true);
      expect(result.value!.written).toBe(true);
      expect(result.value!.revisionId).not.toBe(rev);
    });

    it("increments revision history", async () => {
      const rev = await initArtifact(store, "/test/file.md", "v1");
      await store.write("/test/file.md", "v2", rev, "Update to v2");
      const read = await store.read("/test/file.md");
      expect(read.value!.history.length).toBe(2);
      expect(read.value!.history[0]!.message).toBe("Update to v2");
    });

    it("fails with conflict when revision mismatches", async () => {
      await initArtifact(store, "/test/file.md", "v1");
      const wrongRev = await computeRevisionId("wrong-content");
      const result = await store.write("/test/file.md", "v2", wrongRev);

      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ArtifactConflictError);
      const diag = (result.error as ArtifactConflictError).diagnostic;
      expect(diag.expected).toBe(wrongRev);
      expect(diag.actual).not.toBe(wrongRev);
      expect(diag.callerContent).toBe("v2");
      expect(diag.currentContent).toBe("v1");
    });

    it("preserves caller content in conflict diagnostic", async () => {
      await initArtifact(store, "/test/file.md", "original content");
      const wrongRev = await computeRevisionId("something else");
      const result = await store.write(
        "/test/file.md",
        "updated content",
        wrongRev,
      );

      expect(result.ok).toBe(false);
      const diag = (result.error as ArtifactConflictError).diagnostic;
      expect(diag.callerContent).toBe("updated content");
    });

    it("fails when expectedRevision is 0 but file exists", async () => {
      await initArtifact(store, "/test/file.md", "exists");
      const result = await store.write("/test/file.md", "new", "0");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const diag = (result.error as ArtifactConflictError).diagnostic;
        expect(diag.actual).not.toBe("none");
      }
    });
  });

  describe("crash safety", () => {
    it("does not leave partial content on write failure", async () => {
      const rev = await initArtifact(store, "/test/safe.md", "safe content");
      const wrongRev = await computeRevisionId("wrong");
      const result = await store.write("/test/safe.md", "corrupted", wrongRev);

      expect(result.ok).toBe(false);
      // Original content must still be intact
      const read = await store.read("/test/safe.md");
      expect(read.value!.content).toBe("safe content");
      expect(read.value!.revisionId).toBe(rev);
    });
  });

  describe("diff summary", () => {
    it("generates readable diff for conflict diagnostics", async () => {
      const storeLocal = makeStore();
      await initArtifact(storeLocal, "/test/diff.md", "line1\nline2\nline3");
      const wrongRev = await computeRevisionId("other");
      const result = await storeLocal.write(
        "/test/diff.md",
        "line1\nline2-modified\nline3",
        wrongRev,
      );

      expect(result.ok).toBe(false);
      const diag = (result.error as ArtifactConflictError).diagnostic;
      expect(diag.diffSummary).toContain("-line2");
      expect(diag.diffSummary).toContain("+line2-modified");
    });
  });
});

describe("computeRevisionId", () => {
  it("produces deterministic hash", async () => {
    const a = await computeRevisionId("hello");
    const b = await computeRevisionId("hello");
    expect(a).toBe(b);
  });

  it("produces different hashes for different content", async () => {
    const a = await computeRevisionId("hello");
    const b = await computeRevisionId("world");
    expect(a).not.toBe(b);
  });
});
