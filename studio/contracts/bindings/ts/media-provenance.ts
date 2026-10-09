/**
 * TypeScript bindings generated from media-provenance.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/media-provenance.schema.json
 * Auto-generated — do not edit directly.
 */

import type { ContentHash } from "./identity";

export interface MediaProvenance {
  apiVersion: "studio.video/v1alpha1";
  kind: "MediaProvenance";
  file: {
    /** Relative to the workspace. */
    path: string;
    hash: ContentHash;
    bytes: number;
    mime: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  };
  provider: {
    id: string;
    label: string;
  };
  item: {
    /** The provider's own id: what fetches it again. */
    id: string;
    title: string;
    creator?: string;
    date?: string;
    institution?: string;
    /** The page where a person verifies the item and its licence. */
    landingUrl: string;
    fileUrl: string;
  };
  licence: {
    /** Never `unknown`: an unverified licence is never fetched. */
    id: string;
    /** For public-domain: why it is. */
    basis?: string;
    url?: string;
    attributionRequired: boolean;
    /** What the provider said, as it said it. */
    statement: string;
  };
  /** The credit line ATTRIBUTIONS.md prints. */
  attribution: string;
  retrievedAt: string;
  /** The provider's own response for the item when it was fetched, named by its hash. */
  evidence: {
    path: string;
    hash: ContentHash;
  };
}
