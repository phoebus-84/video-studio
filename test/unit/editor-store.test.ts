import { expect, test } from "vitest";
import { editor } from "$lib/editor-store.svelte.ts";
import type { ArtifactContent, ConflictState } from "$lib/editor-types";

const artifact: ArtifactContent = {
  kind: "markdown",
  text: "original",
  revision: { etag: "rev1", updatedAt: "2026-01-01T00:00:00Z" },
};

test("initial state has no artifact", () => {
  expect(editor.artifact).toBeNull();
  expect(editor.saveState).toBe("clean");
});

test("open loads an artifact", () => {
  editor.open(artifact);
  expect(editor.artifact).not.toBeNull();
  expect(editor.buffer).toBe("original");
  expect(editor.isDirty).toBe(false);
});

test("editing marks dirty", () => {
  editor.open(artifact);
  editor.edit("modified");
  expect(editor.isDirty).toBe(true);
  expect(editor.saveState).toBe("dirty");
});

test("save succeeds updates revision", async () => {
  editor.open(artifact);
  editor.edit("new content");

  await editor.save(async (_text, _rev) => ({
    ok: true,
    revision: { etag: "rev2", updatedAt: "2026-01-02T00:00:00Z" },
  }));

  expect(editor.saveState).toBe("saved");
  expect(editor.artifact!.revision.etag).toBe("rev2");
  expect(editor.artifact!.text).toBe("new content");
  expect(editor.isDirty).toBe(false);
});

test("save conflict enters conflict state", async () => {
  editor.open(artifact);
  editor.edit("our changes");

  const conflict: ConflictState = {
    ours: "our changes",
    theirs: "their changes",
    base: "original",
    serverRevision: { etag: "rev2", updatedAt: "2026-01-02T00:00:00Z" },
  };

  await editor.save(async () => ({ ok: false, conflict }));

  expect(editor.saveState).toBe("conflict");
  expect(editor.conflict).not.toBeNull();
  expect(editor.conflict!.ours).toBe("our changes");
});

test("save error enters error state", async () => {
  editor.open(artifact);

  await editor.save(async () => ({
    ok: false,
    error: "network timeout",
  }));

  expect(editor.saveState).toBe("error");
  expect(editor.errorMessage).toBe("network timeout");
});

test("resolveConflict accepts a version", () => {
  editor.open(artifact);
  editor.edit("our changes");

  editor.resolveConflict("merged result");
  expect(editor.buffer).toBe("merged result");
  expect(editor.saveState).toBe("dirty");
});

test("discard reverts to artifact text", () => {
  editor.open(artifact);
  editor.edit("modified");
  expect(editor.isDirty).toBe(true);

  editor.discard();
  expect(editor.buffer).toBe("original");
  expect(editor.isDirty).toBe(false);
  expect(editor.saveState).toBe("clean");
});
