// ── Image resolver interface ──
// Injected by the pipeline host. Implementations resolve image URIs
// to embeddable data URIs or resolve bundled image assets.

/**
 * Result of resolving an image URI.
 */
export interface ImageResolveResult {
  /** Original request URI */
  uri: string;
  /** Where the image was resolved from */
  source: 'bundled' | 'injected';
  /** Base64-encoded data URI for embedding in SVG (when embedded) */
  dataUri?: string;
  /** Intrinsic width in pixels (when known) */
  width?: number;
  /** Intrinsic height in pixels (when known) */
  height?: number;
  /** MIME type of the resolved image */
  mimeType?: string;
}

/**
 * Resolves image URIs to embeddable data.
 *
 * The renderer calls resolve() for every image reference in a graphic.
 * Implementations must be deterministic and must not initiate network
 * requests. All image data must be pre-bundled or injected at pipeline
 * construction time.
 */
export interface ImageResolver {
  /**
   * Resolve an image URI.
   * @param uri - Image URI (workspace-relative path or bundled key)
   * @returns Resolved image data, or throws if unavailable
   */
  resolve(uri: string): ImageResolveResult;
}
