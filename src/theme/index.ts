// ── Theme module ──

export {
  type Palette,
  type SemanticColors,
  type TypeScale,
  type SpacingScale,
  type StrokeTokens,
  type CornerTokens,
  type SafeAreaProfile,
  type ResolvedDesignTokens,
  type ThemeProvenance,
} from './types.js';

export { VISUAL_BIBLE_DARK, resolveTheme } from './tokens.js';

export { contrastRatio, relativeLuminance, wcagLevel, checkPair, checkPaletteContrast, contrastDiagnostics } from './contrast.js';
export type { ContrastResult, ContrastLevel, PaletteContrastReport } from './contrast.js';

export {
  SAFE_AREA_PROFILES,
  DEFAULT_SAFE_AREA_PROFILE,
  resolveProfile,
  computePixelSafeArea,
  bestFitProfile,
} from './profile.js';
