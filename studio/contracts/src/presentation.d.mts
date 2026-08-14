// Type declarations for the presentation contract.

export type Viewer =
  | "text" | "markdown" | "image" | "video" | "audio"
  | "model-3d" | "data-table" | "timeline" | "download";

export type Action =
  | "edit" | "regenerate" | "compare" | "select" | "restore" | "download";

export interface Presentation {
  viewer: Viewer;
  actions: readonly Action[];
}

export declare const VIEWERS: readonly Viewer[];
export declare const ACTIONS: readonly Action[];
export declare function isViewer(name: string): name is Viewer;
export declare function isAction(name: string): name is Action;
export declare function viewerForContentType(contentType: string | null): Viewer;
export declare function isEditableViewer(viewer: string): boolean;
export declare function resolvePresentation(
  contentType: string | null,
  declared?: { viewer?: string; actions?: string[] } | null,
): Presentation;
