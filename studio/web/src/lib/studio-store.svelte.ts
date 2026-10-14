/**
 * Shell UI state: which view is showing, which files are open, what the
 * inspector is looking at, and whether the palette is up.
 *
 * This is deliberately separate from the data stores. `library`, `episode` and
 * `files` answer "what exists"; this answers "what is the creator looking at".
 * Keeping them apart is what lets a reconnect or a live update refresh the data
 * without collapsing open tabs, resetting the inspector, or closing the palette
 * under the user's hands — which DESIGN.md calls out as a thing the studio must
 * not do.
 */

import { library } from "$lib/library-store.svelte.ts";

export type Level = "channel" | "series" | "episode";

export type View =
  | "overview"
  | "pipeline"
  | "stages"
  | "files"
  | "storyboard"
  | "narration"
  | "audio"
  | "render";

export type InspectorTab =
  | "provenance"
  | "versions"
  | "logs"
  | "comments"
  | "run";

export interface ViewDef {
  key: View;
  label: string;
}

/**
 * Which views each level offers.
 *
 * A channel is an identity, a series is a format, an episode is a production —
 * so they do not get the same tabs. Offering "Render" on a channel would be
 * offering a button that cannot mean anything.
 */
export const VIEWS: Record<Level, ViewDef[]> = {
  channel: [
    { key: "overview", label: "Overview" },
    { key: "files", label: "Files" },
  ],
  series: [
    { key: "overview", label: "Overview" },
    { key: "pipeline", label: "Pipeline" },
    { key: "files", label: "Files" },
  ],
  episode: [
    { key: "stages", label: "Stages" },
    { key: "files", label: "Files" },
    { key: "storyboard", label: "Storyboard" },
    { key: "narration", label: "Narration" },
    { key: "audio", label: "Audio" },
    { key: "render", label: "Render" },
  ],
};

/** The view a level lands on when you arrive at it. */
const DEFAULT_VIEW: Record<Level, View> = {
  channel: "overview",
  series: "overview",
  episode: "stages",
};

export interface AgentStatus {
  kind: "idle" | "working" | "unavailable" | "error";
  text: string;
}

class StudioStore {
  view = $state<View>("stages");
  inspectorTab = $state<InspectorTab>("provenance");

  /** Free-text filter over the library tree. */
  libraryFilter = $state("");

  paletteOpen = $state(false);
  paletteQuery = $state("");

  /** Open file tabs, by path, in the order they were opened. */
  openPaths = $state<string[]>([]);

  /** Draft text in the agent bar, and what Pi last told us. */
  agentDraft = $state("");
  agentStatus = $state<AgentStatus>({ kind: "idle", text: "Pi is idle" });

  /** Which level the library selection points at. */
  get level(): Level {
    if (library.selectedChannel) return "channel";
    if (library.selectedSeries) return "series";
    return "episode";
  }

  get views(): ViewDef[] {
    return VIEWS[this.level];
  }

  /**
   * Move to a view, refusing views the current level does not offer.
   *
   * Without the guard, switching level while on "Render" would leave the canvas
   * asking a channel for a video.
   */
  show(view: View): void {
    if (this.views.some((v) => v.key === view)) this.view = view;
  }

  /** Land on a level's default view. Called when the library selection moves. */
  resetView(): void {
    this.view = DEFAULT_VIEW[this.level];
  }

  /** Open a file in a tab and focus the Files view. */
  openFile(path: string): void {
    if (!this.openPaths.includes(path)) this.openPaths = [...this.openPaths, path];
    this.view = "files";
  }

  closeFile(path: string): void {
    this.openPaths = this.openPaths.filter((p) => p !== path);
  }

  /** Drop every open tab. Used when the level changes, since paths are relative to it. */
  clearFiles(): void {
    this.openPaths = [];
  }

  togglePalette(): void {
    this.paletteOpen = !this.paletteOpen;
    if (!this.paletteOpen) this.paletteQuery = "";
  }

  closePalette(): void {
    this.paletteOpen = false;
    this.paletteQuery = "";
  }
}

export const studio = new StudioStore();
