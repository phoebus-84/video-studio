// ---------------------------------------------------------------------------
// Workspace file watcher
// ---------------------------------------------------------------------------
// Watches the library root for file changes and emits workspace-change
// events through the EventBus. Uses Node.js fs.watch for cross-platform
// recursive watching with debouncing.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import type { EventBus } from "./bus.js";
import { createEvent } from "./bus.js";

export interface WatcherOptions {
  /** Library root directory to watch. */
  root: string;
  /** Debounce window in ms (default 500). */
  debounceMs?: number;
  /** Interval for polling-based detection when native watcher misses events. */
  pollIntervalMs?: number;
}

export class WorkspaceWatcher {
  private bus: EventBus;
  private root: string;
  private debounceMs: number;
  private watcher: fs.FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingPaths = new Set<string>();

  constructor(bus: EventBus, options: WatcherOptions) {
    this.bus = bus;
    this.root = options.root;
    this.debounceMs = options.debounceMs ?? 500;
  }

  /** Start watching the workspace. */
  async start(): Promise<void> {
    // Ensure the root exists
    try {
      await fs.promises.access(this.root);
    } catch {
      // Root doesn't exist yet — we'll still try to watch (fs.watch may fail gracefully)
    }

    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        this.pendingPaths.add(filename);
        this.scheduleFlush();
      });

      this.watcher.on("error", (err) => {
        // Log but don't crash
        console.error("Workspace watcher error:", err.message);
      });
    } catch (err) {
      console.error("Failed to start workspace watcher:", err instanceof Error ? err.message : String(err));
    }
  }

  /** Stop watching. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /** Schedule a debounced flush of pending changes. */
  private scheduleFlush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /** Flush pending changes as events. */
  private async flush(): Promise<void> {
    if (this.pendingPaths.size === 0) return;

    const paths = [...this.pendingPaths];
    this.pendingPaths.clear();
    this.timer = null;

    for (const relPath of paths) {
      const episodeSlug = this.inferEpisodeSlug(relPath);
      const event = createEvent(
        "workspace",
        "file-changed",
        {
          path: relPath,
          absolute: path.join(this.root, relPath),
        },
        episodeSlug,
      );

      this.bus.publish(event);
    }
  }

  /** Infer the episode slug from a relative path like "channel/series/episode/file". */
  private inferEpisodeSlug(relPath: string): string | undefined {
    const parts = relPath.split(path.sep);
    if (parts.length >= 3) {
      return `${parts[0]}/${parts[1]}/${parts[2]}`;
    }
    return undefined;
  }
}
