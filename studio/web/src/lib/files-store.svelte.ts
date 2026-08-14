/**
 * Workspace files for whichever level is selected.
 *
 * The channel view used to guess five filenames — README.md, pipeline.yaml,
 * format.yaml, style-guide.md, art-direction.md — and probe each with a
 * request, because the gateway could not list a directory. It can now, so this
 * shows what is actually there.
 */

import { getGatewayClient } from "./gateway.svelte.ts";

export type Level = "channel" | "series" | "episode";

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
  updatedAt: string;
  contentType: string | null;
}

export interface RevisionMeta {
  id: string;
  createdAt: string;
  size: number;
  revision: string;
  contentAvailable: boolean;
  reason: "edit" | "restore" | "delete";
}

/** Which level a reference points at, and the API prefix that serves it. */
export interface LevelRef {
  level: Level;
  channel: string;
  series?: string;
  episode?: string;
}

export function apiPrefix(ref: LevelRef): string {
  const c = encodeURIComponent(ref.channel);
  if (ref.level === "channel") return `/api/channels/${c}`;
  const s = encodeURIComponent(ref.series!);
  if (ref.level === "series") return `/api/channels/${c}/series/${s}`;
  return `/api/channels/${c}/series/${s}/episodes/${encodeURIComponent(ref.episode!)}`;
}

/** Text files are editable in place; everything else is previewed or downloaded. */
const TEXT_TYPES = /^(text\/|application\/(json|jsonl|xml|yaml))/;

export function isEditable(entry: FileEntry): boolean {
  return entry.kind === "file" && !!entry.contentType && TEXT_TYPES.test(entry.contentType);
}

class FilesStore {
  ref = $state<LevelRef | null>(null);
  entries = $state<FileEntry[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  /** Path of the file currently open in the editor. */
  selectedPath = $state<string | null>(null);
  selectedContent = $state<string>("");
  selectedRevision = $state<string | null>(null);
  selectedType = $state<string | null>(null);
  dirty = $state(false);
  saving = $state(false);

  revisions = $state<RevisionMeta[]>([]);
  /** Revision being previewed, or null when viewing the live file. */
  viewingRevision = $state<string | null>(null);

  /** Load the whole tree for a level. Recursive, so folders can be expanded client-side. */
  async load(ref: LevelRef): Promise<void> {
    this.ref = ref;
    this.loading = true;
    this.error = null;
    this.clearSelection();

    try {
      const data = await getGatewayClient().fetchJSON<{ entries: FileEntry[] }>(
        `${apiPrefix(ref)}/files?recursive=true`,
      );
      this.entries = data.entries ?? [];
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.entries = [];
    } finally {
      this.loading = false;
    }
  }

  async reload(): Promise<void> {
    if (this.ref) await this.load(this.ref);
  }

  clearSelection(): void {
    this.selectedPath = null;
    this.selectedContent = "";
    this.selectedRevision = null;
    this.selectedType = null;
    this.revisions = [];
    this.viewingRevision = null;
    this.dirty = false;
  }

  /** Open a file for viewing or editing. */
  async open(entry: FileEntry): Promise<void> {
    if (!this.ref || entry.kind !== "file") return;
    this.selectedPath = entry.path;
    this.selectedType = entry.contentType;
    this.viewingRevision = null;
    this.dirty = false;

    if (!isEditable(entry)) {
      this.selectedContent = "";
      await this.loadRevisions(entry.path);
      return;
    }

    try {
      const data = await getGatewayClient().fetchJSON<{ content?: string; revision?: string }>(
        `${apiPrefix(this.ref)}/file/${entry.path}`,
      );
      this.selectedContent = data.content ?? "";
      this.selectedRevision = data.revision ?? null;
      await this.loadRevisions(entry.path);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  edit(text: string): void {
    this.selectedContent = text;
    this.dirty = true;
  }

  /** Save the open file, refusing if it changed underneath us. */
  async save(): Promise<void> {
    if (!this.ref || !this.selectedPath || this.saving) return;
    this.saving = true;
    this.error = null;
    try {
      const res = await getGatewayClient().fetchJSON<{ revision: string }>(
        `${apiPrefix(this.ref)}/files`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: this.selectedPath,
            content: this.selectedContent,
            expectedRevision: this.selectedRevision ?? undefined,
          }),
        },
      );
      this.selectedRevision = res.revision;
      this.dirty = false;
      await this.loadRevisions(this.selectedPath);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }

  async loadRevisions(filePath: string): Promise<void> {
    if (!this.ref) return;
    try {
      const data = await getGatewayClient().fetchJSON<{ revisions: RevisionMeta[] }>(
        `${apiPrefix(this.ref)}/revisions?path=${encodeURIComponent(filePath)}`,
      );
      this.revisions = data.revisions ?? [];
    } catch {
      this.revisions = [];
    }
  }

  /** Preview an older version without touching the live file. */
  async viewRevision(id: string): Promise<void> {
    if (!this.ref || !this.selectedPath) return;
    try {
      const res = await fetch(
        `${getGatewayClient().baseUrl}${apiPrefix(this.ref)}/revisions` +
          `?path=${encodeURIComponent(this.selectedPath)}&id=${encodeURIComponent(id)}`,
        { headers: { authorization: `Bearer ${getGatewayClient().token ?? ""}` } },
      );
      if (!res.ok) throw new Error(`Could not read revision (${res.status})`);
      this.selectedContent = await res.text();
      this.viewingRevision = id;
      this.dirty = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Go back to the live file after previewing a revision. */
  async viewLive(): Promise<void> {
    if (!this.ref || !this.selectedPath) return;
    const path = this.selectedPath;
    const entry = this.entries.find((e) => e.path === path);
    if (entry) await this.open(entry);
  }

  /** Restore a version. The current content is kept, so this is undoable. */
  async restore(id: string): Promise<void> {
    if (!this.ref || !this.selectedPath) return;
    try {
      await getGatewayClient().fetchJSON(`${apiPrefix(this.ref)}/revisions/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: this.selectedPath, id }),
      });
      await this.viewLive();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async create(path: string, kind: "file" | "directory"): Promise<void> {
    if (!this.ref) return;
    try {
      await getGatewayClient().fetchJSON(`${apiPrefix(this.ref)}/files`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, kind }),
      });
      await this.reload();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async remove(path: string, recursive: boolean): Promise<void> {
    if (!this.ref) return;
    try {
      await getGatewayClient().fetchJSON(
        `${apiPrefix(this.ref)}/files?path=${encodeURIComponent(path)}` +
          (recursive ? "&recursive=true" : ""),
        { method: "DELETE" },
      );
      if (this.selectedPath === path) this.clearSelection();
      await this.reload();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Upload files of any type into a directory at this level. */
  async upload(dir: string, files: FileList): Promise<void> {
    if (!this.ref || files.length === 0) return;
    const form = new FormData();
    if (dir) form.append("dir", dir);
    for (const file of files) form.append("file", file);

    try {
      const client = getGatewayClient();
      const res = await fetch(`${client.baseUrl}${apiPrefix(this.ref)}/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${client.token ?? ""}` },
        body: form,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      await this.reload();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Object URL for previewing a binary file.
   *
   * Fetched with the bearer header and wrapped in a blob rather than putting
   * the token in a query string, which would leak it into browser history and
   * any proxy log. Callers revoke the URL when the preview goes away.
   */
  async mediaUrl(path: string): Promise<string | null> {
    if (!this.ref) return null;
    const client = getGatewayClient();
    try {
      const res = await fetch(`${client.baseUrl}${apiPrefix(this.ref)}/file/${path}`, {
        headers: { authorization: `Bearer ${client.token ?? ""}` },
      });
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  }
}

export const files = new FilesStore();
