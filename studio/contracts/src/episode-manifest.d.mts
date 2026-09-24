// Type declarations for the on-disk episode manifest.

export interface EpisodeManifestFields {
  slug: string;
  channel?: string;
  series?: string;
  title?: string;
  description?: string;
  createdAt?: string;
}

export declare const EPISODE_MANIFEST_FILE: string;
export declare function renderEpisodeManifest(fields: EpisodeManifestFields): string;
