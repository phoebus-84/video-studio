/**
 * TypeScript bindings generated from kit-release.schema.json
 * Schema: https://schemas.studio.video/v1alpha1/kit-release.schema.json
 * Auto-generated — do not edit directly.
 */

import type { Slug, ContentHash } from "./identity";

export interface KitRelease {
  apiVersion: "studio.video/v1alpha1";
  kind: "KitRelease";
  name: Slug;
  /** An exact released version. */
  version: string;
  /** The CommonJS bundle `vpr kit seal` built from kit/index.tsx, React, Remotion and zod left to the application; `hash` is its sha256. */
  bundle: {
    path: "kit.cjs";
    hash: ContentHash;
  };
}
