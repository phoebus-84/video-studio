// ── Font resolver interface ──
// Injected by the pipeline host. Implementations may resolve from
// system fonts, bundled fonts, or injected font data.

/**
 * Result of resolving a font family + weight + style to a concrete
 * CSS font-family spec and source annotation.
 */
export interface FontResolveResult {
  /** Resolved family name (may differ from request if aliased) */
  family: string;
  /** Numeric font weight (100-900) */
  weight: number;
  /** Font style */
  style: 'normal' | 'italic';
  /** Where the font was resolved from */
  source: 'system' | 'bundled' | 'injected';
  /** CSS-ready font-family string for SVG font-family attribute */
  cssSpec: string;
}

/**
 * Resolves font specifications to concrete CSS values.
 *
 * The renderer calls resolve() for every distinct font used in a
 * graphic. Implementations must be deterministic: the same input
 * must produce the same output within a pinned environment.
 */
export interface FontResolver {
  /**
   * Resolve a font request.
   * @param family - Requested font family name
   * @param weight - Requested weight (400 = normal, 700 = bold)
   * @param style - Requested style
   * @returns Resolved font information, or throws if unavailable
   */
  resolve(
    family: string,
    weight: number,
    style: 'normal' | 'italic',
  ): FontResolveResult;
}
