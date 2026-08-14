// ── Design token types ──
// Maps Visual Bible design tokens into reproducible graphic styles.
// All values are concrete and pinned — no runtime resolution.

// ── Palette ──

export interface Palette {
  /** CSS hex, e.g. "#1a1a2e" */
  background: string;
  foreground: string;
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
  border: string;
  /** Semantic overrides for specific contexts */
  semantic: SemanticColors;
}

export interface SemanticColors {
  success: string;
  warning: string;
  error: string;
  info: string;
  /** Highlight used for code-frame line emphasis */
  highlight: string;
  /** Dimmed foreground for secondary text */
  dimmed: string;
  /** Surface fill for cards/elevated regions */
  surface: string;
}

// ── Type scale ──

export interface TypeScale {
  /** Font size in px for each named step */
  xs: number;
  sm: number;
  base: number;
  md: number;
  lg: number;
  xl: number;
  '2xl': number;
  '3xl': number;
}

// ── Spacing scale ──

export interface SpacingScale {
  /** Base unit in px */
  unit: number;
  /** Named spacing steps (multiples of unit) */
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  '2xl': number;
}

// ── Stroke ──

export interface StrokeTokens {
  /** Hairline stroke width in px */
  hairline: number;
  /** Default border stroke width in px */
  regular: number;
  /** Emphasis stroke width in px */
  emphasis: number;
}

// ── Corner ──

export interface CornerTokens {
  /** No rounding */
  none: number;
  /** Subtle rounding for small elements */
  sm: number;
  /** Default rounding for cards and frames */
  md: number;
  /** Generous rounding for large containers */
  lg: number;
  /** Pill/capsule rounding */
  full: number;
}

// ── Safe area profile ──

export interface SafeAreaProfile {
  /** Profile identifier, e.g. "16:9", "4:3", "1:1" */
  id: string;
  /** Human-readable label */
  label: string;
  /** Aspect ratio as width/height */
  aspectRatio: number;
  /**
   * Safe area as fraction of the total dimension.
   * 0 = edge, 1 = full opposite edge.
   * The safe area is inset from each edge by the given fraction.
   */
  topFraction: number;
  rightFraction: number;
  bottomFraction: number;
  leftFraction: number;
}

// ── Resolved theme ──

export interface ResolvedDesignTokens {
  palette: Palette;
  typeScale: TypeScale;
  spacing: SpacingScale;
  stroke: StrokeTokens;
  corner: CornerTokens;
  profile: SafeAreaProfile;
  /** Theme provenance for result metadata */
  provenance: ThemeProvenance;
}

export interface ThemeProvenance {
  /** Theme identifier, e.g. "visual-bible-dark" */
  themeId: string;
  /** Version of the token set */
  version: string;
  /** Source of tokens: "bundled" | "injected" */
  source: 'bundled' | 'injected';
  /** ISO 8601 timestamp when this token set was pinned */
  pinnedAt: string;
}
