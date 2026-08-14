/**
 * How an artifact asks to be shown.
 *
 * The studio used to decide this with a chain of `if` statements over content
 * types, one branch per kind of thing. Adding a kind — a 3D render, a
 * waveform, a diff — meant editing the workspace component, which is the same
 * mistake as the five hardcoded filenames and the denylist of names that are
 * not a series: the UI hardcoding what the system should declare.
 *
 * Here an artifact names a *viewer* and the *actions* it supports. The studio
 * resolves the name against a registry of components. Shipping a new kind is
 * therefore: write the component, register it under a name, declare that name.
 * No branch anywhere changes, and an unknown name degrades to a download card
 * rather than breaking the page.
 */

/**
 * Viewer names the studio knows how to resolve.
 *
 * A name is a contract between a producer (a pipeline output, a file type) and
 * a consumer (a registered component). Adding one here is a deliberate act;
 * the studio may ship a component for it before or after.
 */
export const VIEWERS = Object.freeze([
  "text",        // plain or structured text, editable in place
  "markdown",    // prose, editable in place
  "image",       // a still
  "video",       // a clip, with transport controls
  "audio",       // a waveform or player
  "model-3d",    // a mesh or scene
  "data-table",  // rows and columns
  "timeline",    // scenes over time
  "download",    // no preview; offer the bytes
]);

/** Actions an artifact may offer, beyond viewing it. */
export const ACTIONS = Object.freeze([
  "edit",        // change the content in place
  "regenerate",  // ask the producing stage to make it again
  "compare",     // put two attempts side by side
  "select",      // choose this attempt to fulfil its production role
  "restore",     // bring back an earlier version
  "download",    // take the bytes
]);

export function isViewer(name) {
  return VIEWERS.includes(name);
}

export function isAction(name) {
  return ACTIONS.includes(name);
}

/**
 * Default viewer for a content type.
 *
 * This is the fallback when nothing declares a preference, so a file dropped
 * into a workspace still shows sensibly. A declaration always wins over it.
 */
export function viewerForContentType(contentType) {
  if (!contentType) return "download";
  if (contentType === "text/markdown") return "markdown";
  if (contentType === "text/csv") return "data-table";
  if (contentType.startsWith("text/")) return "text";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("model/")) return "model-3d";
  if (contentType === "application/json" || contentType === "application/jsonl") return "text";
  if (contentType === "application/xml" || contentType === "application/yaml") return "text";
  return "download";
}

/** Viewers whose content is editable text. */
const EDITABLE = new Set(["text", "markdown"]);

export function isEditableViewer(viewer) {
  return EDITABLE.has(viewer);
}

/**
 * Resolve the presentation for an artifact.
 *
 * @param contentType  detected media type, or null
 * @param declared     `presentation` from a pipeline manifest, if any
 * @returns `{ viewer, actions }`
 */
export function resolvePresentation(contentType, declared = null) {
  const viewer = declared?.viewer && isViewer(declared.viewer)
    ? declared.viewer
    : viewerForContentType(contentType);

  // A declaration may narrow or extend the actions; otherwise infer the
  // obvious ones from the viewer.
  const actions = Array.isArray(declared?.actions)
    ? declared.actions.filter(isAction)
    : defaultActions(viewer);

  return { viewer, actions };
}

function defaultActions(viewer) {
  const actions = ["download", "restore"];
  if (isEditableViewer(viewer)) actions.unshift("edit");
  return Object.freeze(actions);
}
