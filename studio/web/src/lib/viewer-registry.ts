/**
 * Viewer components, by name.
 *
 * The file viewer used to be a chain of `if` statements over content types —
 * one branch per kind of artifact — so adding a kind meant editing the
 * workspace. Here the artifact names a viewer and this maps the name to a
 * component.
 *
 * Adding 3D, a waveform, a diff or a scene timeline is therefore:
 *
 *   1. write the component
 *   2. register it here under its name
 *   3. declare that name from the pipeline output (or let the content type
 *      imply it)
 *
 * No branch anywhere changes. A name with no component registered falls back
 * to the download card, so an artifact the studio has never seen degrades
 * instead of breaking the page.
 */

import type { Component } from "svelte";
import TextViewer from "$components/viewers/TextViewer.svelte";
import ImageViewer from "$components/viewers/ImageViewer.svelte";
import VideoViewer from "$components/viewers/VideoViewer.svelte";
import AudioViewer from "$components/viewers/AudioViewer.svelte";
import DownloadViewer from "$components/viewers/DownloadViewer.svelte";

/** Props every viewer receives. */
export interface ViewerProps {
  /** Path of the file, relative to its level. */
  path: string;
  /** Detected media type, when known. */
  contentType: string | null;
  /** Text content, for viewers that edit or render text. */
  content: string;
  /** Object URL for binary content, when the viewer needs bytes. */
  mediaSrc: string | null;
  /** True while previewing an older version, which must not be edited. */
  readOnly: boolean;
  /** Report an edit back to the store. */
  onEdit: (text: string) => void;
}

const REGISTRY: Record<string, Component<ViewerProps>> = {
  text: TextViewer,
  markdown: TextViewer,
  image: ImageViewer,
  video: VideoViewer,
  audio: AudioViewer,
  download: DownloadViewer,
  // model-3d, data-table and timeline are declared in the contract but have no
  // component yet. They resolve to the download card until one is registered,
  // which is the point: the contract can describe more than the studio renders.
};

/** The component for a viewer name, or the download card when none is registered. */
export function viewerComponent(name: string | undefined): Component<ViewerProps> {
  return (name && REGISTRY[name]) || DownloadViewer;
}

/** Whether a component is registered for this name. */
export function hasViewer(name: string | undefined): boolean {
  return !!name && name in REGISTRY;
}

/** Viewers that need the file's bytes rather than its text. */
const BINARY_VIEWERS = new Set(["image", "video", "audio", "model-3d", "download"]);

export function needsBytes(name: string | undefined): boolean {
  return !!name && BINARY_VIEWERS.has(name);
}
