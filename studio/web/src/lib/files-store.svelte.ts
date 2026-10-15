/**
 * Workspace files for whichever level is selected.
 *
 * The channel view used to guess five filenames — README.md, pipeline.yaml,
 * format.yaml, style-guide.md, art-direction.md — and probe each with a
 * request, because the gateway could not list a directory. It can now, so this
 * shows what is actually there.
 */

import { getGatewayClient } from "./gateway.svelte.ts";
import { libraryUrlPath } from "@studio/contracts/src/library-url.mjs";

export type Level = "channel" | "series" | "episode";

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
  updatedAt: string;
  contentType: string | null;
  /** How this artifact asks to be shown; resolved against the viewer registry. */
  presentation: { viewer: string; actions: readonly string[] } | null;
  /** True when a .uiignore rule leaves this out and the listing shows it anyway. */
  ignored?: boolean;
}

/** Where this browser remembers whether to show files the .uiignore rules leave out. */
export const SHOW_IGNORED_STORAGE = "vs-files-show-ignored";

function readShowIgnored(): boolean {
  try {
    return localStorage.getItem(SHOW_IGNORED_STORAGE) === "true";
  } catch {
    return false;
  }
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

/**
 * Whether a file's content should be fetched as text.
 *
 * Taken from the artifact's declared viewer rather than a regex over media
 * types, so a new editable kind needs no change here.
 */
export function isEditable(entry: FileEntry): boolean {
  const viewer = entry.presentation?.viewer;
  return entry.kind === "file" && (viewer === "text" || viewer === "markdown");
}

class FilesStore {
  ref = $state<LevelRef | null>(null);
  entries = $state<FileEntry[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  /**
   * Whether the listing includes what the .uiignore rules leave out (lock
   * files, node_modules/, … and whatever a channel or series adds).
   */
  showIgnored = $state(readShowIgnored());
  /** How many entries the rules left out, or marked when shown. */
  ignoredCount = $state(0);

  /** Path of the file currently open in the editor. */
  selectedPath = $state<string | null>(null);
  selectedContent = $state<string>("");
  selectedRevision = $state<string | null>(null);
  selectedType = $state<string | null>(null);
  selectedPresentation = $state<{ viewer: string; actions: readonly string[] } | null>(null);
  dirty = $state(false);
  saving = $state(false);

  revisions = $state<RevisionMeta[]>([]);
  /** Revision being previewed, or null when viewing the live file. */
  viewingRevision = $state<string | null>(null);
  /** Revision being compared against the live file, or null when not comparing. */
  comparingRevision = $state<string | null>(null);
  /** Content of the compared revision. */
  comparisonContent = $state<string>("");
  /** Live content, held while a comparison is open. */
  liveContent = $state<string>("");

  /** Load the whole tree for a level. Recursive, so folders can be expanded client-side. */
  async load(ref: LevelRef): Promise<void> {
    this.ref = ref;
    this.loading = true;
    this.error = null;
    this.clearSelection();

    try {
      await this.fetchListing(ref);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.entries = [];
      this.ignoredCount = 0;
    } finally {
      this.loading = false;
    }
  }

  async reload(): Promise<void> {
    if (this.ref) await this.load(this.ref);
  }

  /** The level's tree, as the .uiignore rules and the show-all choice leave it. */
  private async fetchListing(ref: LevelRef): Promise<void> {
    const data = await getGatewayClient().fetchJSON<{ entries: FileEntry[]; ignored?: number }>(
      `${apiPrefix(ref)}/files?recursive=true${this.showIgnored ? "&showIgnored=true" : ""}`,
    );
    this.entries = data.entries ?? [];
    this.ignoredCount = data.ignored ?? 0;
  }

  /** Refresh the tree without closing the open file. */
  async refreshListing(): Promise<void> {
    if (!this.ref) return;
    try {
      await this.fetchListing(this.ref);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Show or leave out what the .uiignore rules match, and remember the choice. */
  async setShowIgnored(show: boolean): Promise<void> {
    this.showIgnored = show;
    try {
      localStorage.setItem(SHOW_IGNORED_STORAGE, String(show));
    } catch {
      /* A choice not remembered still applies now. */
    }
    await this.refreshListing();
  }

  clearSelection(): void {
    this.selectedPath = null;
    this.selectedContent = "";
    this.selectedRevision = null;
    this.selectedType = null;
    this.selectedPresentation = null;
    this.revisions = [];
    this.viewingRevision = null;
    this.comparingRevision = null;
    this.comparisonContent = "";
    this.liveContent = "";
    this.dirty = false;
  }

  /** Open a file for viewing or editing. */
  async open(entry: FileEntry): Promise<void> {
    if (!this.ref || entry.kind !== "file") return;
    this.selectedPath = entry.path;
    this.selectedType = entry.contentType;
    this.selectedPresentation = entry.presentation;
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

  /**
   * Read a file's text without opening it.
   *
   * `open` is a navigation: it changes what the viewer is showing and loads a
   * revision list. A panel that only needs to *look* at a file — the pipeline
   * view reading the manifest to draw it — must not drag the editor along with
   * it. Returns null when the file cannot be read.
   */
  async readText(filePath: string): Promise<string | null> {
    if (!this.ref) return null;
    try {
      const data = await getGatewayClient().fetchJSON<{ content?: string }>(
        `${apiPrefix(this.ref)}/file/${filePath}`,
      );
      return data.content ?? null;
    } catch {
      return null;
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
      // New rules change what the tree shows.
      if (this.selectedPath.split("/").pop() === ".uiignore") await this.refreshListing();
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

  /** Fetch one revision's text. */
  async #revisionText(id: string): Promise<string | null> {
    if (!this.ref || !this.selectedPath) return null;
    const client = getGatewayClient();
    const res = await fetch(
      `${client.baseUrl}${apiPrefix(this.ref)}/revisions` +
        `?path=${encodeURIComponent(this.selectedPath)}&id=${encodeURIComponent(id)}`,
      { headers: { authorization: `Bearer ${client.token ?? ""}` } },
    );
    if (!res.ok) return null;
    return res.text();
  }

  /**
   * Compare a version against the live file.
   *
   * A version list answers "when did this change"; only a comparison answers
   * "what changed".
   */
  async compare(id: string): Promise<void> {
    const text = await this.#revisionText(id);
    if (text === null) {
      this.error = "Could not read that version";
      return;
    }
    this.liveContent = this.selectedContent;
    this.comparisonContent = text;
    this.comparingRevision = id;
    this.viewingRevision = null;
  }

  /** Close the comparison and go back to the live file. */
  stopComparing(): void {
    this.comparingRevision = null;
    this.comparisonContent = "";
    this.selectedContent = this.liveContent || this.selectedContent;
    this.liveContent = "";
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
      this.comparingRevision = null;
      this.dirty = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Object URL for an older version's bytes.
   *
   * `#revisionText` reads a revision as text, which is right for a diff and
   * useless for an image. Comparing two renders of the same frame is the whole
   * point of keeping attempts, so the bytes have to be reachable too. Fetched
   * with the bearer header and wrapped in a blob rather than putting the token
   * in a query string; callers revoke the URL.
   */
  async revisionMediaUrl(filePath: string, id: string): Promise<string | null> {
    if (!this.ref) return null;
    const client = getGatewayClient();
    try {
      const res = await fetch(
        `${client.baseUrl}${apiPrefix(this.ref)}/revisions` +
          `?path=${encodeURIComponent(filePath)}&id=${encodeURIComponent(id)}`,
        { headers: { authorization: `Bearer ${client.token ?? ""}` } },
      );
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  }

  /**
   * Raw bytes for a file.
   *
   * Separate from `mediaUrl` because some views need the content itself rather
   * than something to point an element at — decoding audio to draw its real
   * waveform, for one. Going through the object URL instead would mean racing
   * that URL's lifetime.
   */
  async mediaBytes(filePath: string): Promise<ArrayBuffer | null> {
    const url = this.mediaUrl(filePath);
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
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
   * A streamable URL for a media file.
   *
   * This used to fetch the whole file with the bearer header and wrap it in a
   * blob. That works, but a blob URL is the finished bytes: the browser cannot
   * ask for part of it, so a 40 MB render had to download completely before the
   * first frame appeared and seeking was impossible.
   *
   * The gateway already serves the library over `@fastify/static`, which honours
   * `Range` — so pointing the element straight at that route gives progressive
   * playback and real seeking for free, and nothing is buffered in memory. That
   * route is deliberately public (localhost, read-only), which is what makes it
   * usable from a `<video src>` that cannot carry an Authorization header.
   *
   * Synchronous, and null when the path escapes the level rather than firing a
   * request that is certain to fail.
   */
  mediaUrl(path: string): string | null {
    if (!this.ref) return null;
    const libraryPath = libraryUrlPath(this.ref, path);
    if (!libraryPath) return null;
    return `${getGatewayClient().baseUrl}${libraryPath}`;
  }
}

export const files = new FilesStore();
