/**
 * TypeScript bindings generated from series-template.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/series-template.schema.json
 * Auto-generated — do not edit directly.
 */

import type { Slug, RevisionNumber, ContentHash, PortableRelativePath } from "./identity";
import type { GateReview } from "./gate-review";

export type TemplateVersion = string;

export interface SeriesComponentRef {
  id: Slug;
  version: TemplateVersion;
}

export interface TemplatePin {
  id: Slug;
  version: TemplateVersion;
  hash: ContentHash;
}

export interface SeriesEpisodeRef {
  channel: Slug;
  series: Slug;
  episode: Slug;
}

export interface SeriesFileRef {
  path: PortableRelativePath;
  hash: ContentHash;
}

export interface SeriesTemplate {
  apiVersion: "studio.video/v1alpha1";
  kind: "SeriesTemplate";
  id: Slug;
  version: TemplateVersion;
  compiler: SeriesComponentRef;
  validator?: SeriesComponentRef;
  files: {
    schema: SeriesFileRef;
    template: SeriesFileRef;
    standard: SeriesFileRef;
  };
  metadata?: Record<string, unknown>;
}

export interface EpisodeSpec {
  apiVersion: "studio.video/v1alpha1";
  kind: "EpisodeSpec";
  episodeRef: SeriesEpisodeRef;
  revision: RevisionNumber;
  template: TemplatePin;
  /** Editable series-specific data, checked against the pinned series schema. Drafts may contain __FILL__; compilation must reject them. */
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SeriesReference {
  apiVersion: "studio.video/v1alpha1";
  kind: "SeriesReference";
  id: Slug;
  episodeRef: SeriesEpisodeRef;
  template: TemplatePin;
  spec: SeriesFileRef;
  timeline: SeriesFileRef;
  render: SeriesFileRef;
  report: SeriesFileRef;
  /** Preserved human approval receipt bound to these exact artifacts. Shape is not proof: the runtime must verify its signature and the files before trusting a reference. */
  approval: GateReview;
  metadata?: Record<string, unknown>;
}
