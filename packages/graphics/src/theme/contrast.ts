// ── WCAG contrast diagnostics ──
// Computes relative luminance and contrast ratios per WCAG 2.1.
// Used by the pipeline to flag unreadable color combinations
// in rendered output.

import type { Palette } from './types.js';

// ── Contrast types ──

export type ContrastLevel = 'AAA' | 'AA' | 'AA-Large' | 'fail';

export interface ContrastResult {
  /** The two colors compared, as hex strings */
  foreground: string;
  background: string;
  /** Contrast ratio (1.0 – 21.0) */
  ratio: number;
  /** WCAG compliance level */
  level: ContrastLevel;
  /** Human-readable description of the role pair */
  pair: string;
}

export interface PaletteContrastReport {
  /** Theme palette id */
  paletteId: string;
  /** Ordered list of all computed contrasts */
  results: ContrastResult[];
  /** Pairs that fail WCAG AA (ratio < 4.5) */
  failures: ContrastResult[];
  /** Pairs that achieve WCAG AA but not AAA */
  warnings: ContrastResult[];
}

// ── WCAG relative luminance ──

function hexToRgb(hex: string): [number, number, number] {
  // Handle named/common formats; only hex and rgb() supported here
  const stripped = hex.replace(/^#/, '');
  if (stripped.length === 3) {
    // Short form: #abc → #aabbcc
    const [r, g, b] = stripped.split('').map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  // Handle rgb() / rgba() format
  if (hex.startsWith('rgb')) {
    const match = hex.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (match) {
      return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
    }
    return [0, 0, 0];
  }
  const r = parseInt(stripped.slice(0, 2), 16);
  const g = parseInt(stripped.slice(2, 4), 16);
  const b = parseInt(stripped.slice(4, 6), 16);
  return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b];
}

function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Compute WCAG 2.1 relative luminance for an sRGB hex color.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Compute WCAG 2.1 contrast ratio between two sRGB colors.
 * Ratio is in range 1.0 (identical) to 21.0 (black vs white).
 */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determine WCAG compliance level for a contrast ratio.
 */
export function wcagLevel(ratio: number, isLargeText: boolean = false): ContrastLevel {
  if (ratio >= 7) return 'AAA';
  if (isLargeText) {
    if (ratio >= 3) return 'AA-Large';
  }
  if (ratio >= 4.5) return 'AA';
  return 'fail';
}

/**
 * Check a single color pair and return a diagnostic result.
 */
export function checkPair(
  foreground: string,
  background: string,
  pair: string,
  isLargeText: boolean = false,
): ContrastResult {
  const ratio = contrastRatio(foreground, background);
  const level = wcagLevel(ratio, isLargeText);
  return { foreground, background, ratio, level, pair };
}

// ── Bulk palette diagnostics ──

/**
 * Check all semantically meaningful color pairs in a palette.
 *
 * Checks:
 *   - Foreground on background
 *   - Muted on background
 *   - Primary on background
 *   - Semantic success/warning/error/info on background
 *   - Foreground on primary (for inverted text)
 *   - Foreground on surface
 */
export function checkPaletteContrast(palette: Palette): PaletteContrastReport {
  const { background, foreground, primary, secondary, accent, muted, semantic } = palette;
  const check = (fg: string, bg: string, label: string): ContrastResult =>
    checkPair(fg, bg, label);

  const results: ContrastResult[] = [
    check(foreground, background, 'foreground/background'),
    check(muted, background, 'muted/background'),
    check(primary, background, 'primary/background'),
    check(secondary, background, 'secondary/background'),
    check(accent, background, 'accent/background'),
    check(semantic.success, background, 'success/background'),
    check(semantic.warning, background, 'warning/background'),
    check(semantic.error, background, 'error/background'),
    check(semantic.info, background, 'info/background'),
    check(semantic.dimmed, background, 'dimmed/background'),
    check(foreground, primary, 'foreground/primary'),
    check(foreground, semantic.surface, 'foreground/surface'),
    // Inverted text: background on primary (for filled buttons)
    check(background, primary, 'background-on-primary'),
  ];

  const failures = results.filter((r) => r.level === 'fail');
  const warnings = results.filter((r) => r.level === 'AA' && r.ratio < 7);

  return {
    paletteId: `palette-${results[0]?.foreground ?? 'unknown'}-${results[0]?.background ?? 'unknown'}`,
    results,
    failures,
    warnings,
  };
}

/**
 * Convert a contrast report into render diagnostics.
 * Only emits warnings/errors for failing pairs.
 */
export function contrastDiagnostics(report: PaletteContrastReport): Array<{
  code: string;
  message: string;
  level: 'info' | 'warning' | 'error';
}> {
  const diags: Array<{ code: string; message: string; level: 'info' | 'warning' | 'error' }> = [];

  for (const f of report.failures) {
    diags.push({
      code: 'contrast.insufficient',
      level: 'info',
      message: `Color pair "${f.pair}" has insufficient contrast (${f.ratio.toFixed(2)}:1). ` +
        `Foreground=${f.foreground}, Background=${f.background}. ` +
        `Minimum required is 4.5:1 for normal text or 3:1 for large text.`,
    });
  }

  return diags;
}
