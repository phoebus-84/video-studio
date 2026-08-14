// ── Bundled design tokens ──
// Visual Bible Dark — the default pinned theme.
// All values are concrete; no runtime platform resolution.

import type {
  Palette,
  TypeScale,
  SpacingScale,
  StrokeTokens,
  CornerTokens,
  ResolvedDesignTokens,
} from './types.js';
import { DEFAULT_SAFE_AREA_PROFILE } from './profile.js';

// ── Visual Bible Dark palette ──

const VISUAL_BIBLE_DARK_PALETTE: Palette = {
  background: '#1a1a2e',
  foreground: '#e0e0e0',
  primary: '#7b68ee',
  secondary: '#48c9b0',
  accent: '#f39c12',
  muted: '#6c6c80',
  border: '#2d2d44',
  semantic: {
    success: '#2ecc71',
    warning: '#f39c12',
    error: '#e74c3c',
    info: '#3498db',
    highlight: 'rgba(123, 104, 238, 0.15)',
    dimmed: '#8e8ea0',
    surface: '#222244',
  },
};

// ── Type scale (8px base, major third) ──

const TYPE_SCALE: TypeScale = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 20,
  xl: 28,
  '2xl': 36,
  '3xl': 48,
};

// ── Spacing scale (8px unit) ──

const SPACING_SCALE: SpacingScale = {
  unit: 8,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
};

// ── Stroke tokens ──

const STROKE_TOKENS: StrokeTokens = {
  hairline: 0.5,
  regular: 1,
  emphasis: 2,
};

// ── Corner tokens ──

const CORNER_TOKENS: CornerTokens = {
  none: 0,
  sm: 3,
  md: 6,
  lg: 12,
  full: 9999,
};

// ── Resolved token set ──

export const VISUAL_BIBLE_DARK: ResolvedDesignTokens = {
  palette: VISUAL_BIBLE_DARK_PALETTE,
  typeScale: TYPE_SCALE,
  spacing: SPACING_SCALE,
  stroke: STROKE_TOKENS,
  corner: CORNER_TOKENS,
  profile: DEFAULT_SAFE_AREA_PROFILE,
  provenance: {
    themeId: 'visual-bible-dark',
    version: '1.0.0',
    source: 'bundled',
    pinnedAt: '2026-07-27T00:00:00.000Z',
  },
};

// ── Helpers ──

/** The single bundled theme. Future: resolve from injected registry. */
export function resolveTheme(_themeId?: string): ResolvedDesignTokens {
  // In this phase only the bundled theme exists.
  // When themeId is provided and unrecognized, we diagnose.
  if (_themeId !== undefined && _themeId !== 'visual-bible-dark') {
    // Unknown theme: return the default but caller should emit a diagnostic.
    // Return typed with the bundled default; the diagnostic is emitted at the
    // pipeline layer where it's connected to the result envelope.
    return VISUAL_BIBLE_DARK;
  }
  return VISUAL_BIBLE_DARK;
}
