// ── Font diagnostics ──
// Missing-glyph detection and fallback diagnostics.
// These are deterministic checks that operate on coverage metadata,
// not actual glyph rendering (which requires font files at rasterization time).

import type { FontEntry } from './registry.js';

// ── Unicode block definitions (used for coverage diagnostics) ──

interface UnicodeBlock {
  name: string;
  /** First code point (inclusive) */
  start: number;
  /** Last code point (inclusive) */
  end: number;
}

const KNOWN_BLOCKS: UnicodeBlock[] = [
  { name: 'Basic Latin', start: 0x0000, end: 0x007F },
  { name: 'Latin-1 Supplement', start: 0x0080, end: 0x00FF },
  { name: 'Latin Extended-A', start: 0x0100, end: 0x017F },
  { name: 'Latin Extended-B', start: 0x0180, end: 0x024F },
  { name: 'Greek and Coptic', start: 0x0370, end: 0x03FF },
  { name: 'Cyrillic', start: 0x0400, end: 0x04FF },
  { name: 'Arabic', start: 0x0600, end: 0x06FF },
  { name: 'Devanagari', start: 0x0900, end: 0x097F },
  { name: 'CJK Unified Ideographs', start: 0x4E00, end: 0x9FFF },
  { name: 'Box Drawing', start: 0x2500, end: 0x257F },
  { name: 'General Punctuation', start: 0x2000, end: 0x206F },
  { name: 'Mathematical Operators', start: 0x2200, end: 0x22FF },
  { name: 'Emoticons', start: 0x1F600, end: 0x1F64F },
  { name: 'Miscellaneous Symbols', start: 0x2600, end: 0x26FF },
  { name: 'Dingbats', start: 0x2700, end: 0x27BF },
];

// ── Diagnostic types ──

export interface MissingGlyphResult {
  /** Character that may be missing */
  char: string;
  /** Unicode code point as U+XXXX */
  codePoint: string;
  /** The Unicode block containing this character */
  block: string;
  /** Whether the font's coverage includes this block */
  fontHasBlock: boolean;
}

export interface FontCoverageDiagnostic {
  /** Font family name */
  fontFamily: string;
  /** Text that was checked */
  text: string;
  /** Characters not covered by the font */
  missing: MissingGlyphResult[];
  /** Summary: whether all characters are covered */
  fullyCovered: boolean;
}

// ── Coverage checking ──

/**
 * Determine which Unicode block a code point belongs to.
 */
export function findBlock(codePoint: number): string {
  for (const block of KNOWN_BLOCKS) {
    if (codePoint >= block.start && codePoint <= block.end) {
      return block.name;
    }
  }
  return 'Unknown';
}

/**
 * Check whether a given text string contains characters
 * not covered by a font's declared coverage.
 */
export function checkCoverage(
  text: string,
  fontEntry: FontEntry,
): FontCoverageDiagnostic {
  const missing: MissingGlyphResult[] = [];
  const coveredBlocks = new Set(fontEntry.coverage.blocks);

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;

    const block = findBlock(codePoint);
    const fontHasBlock = coveredBlocks.has(block);

    if (!fontHasBlock) {
      const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
      missing.push({
        char,
        codePoint: `U+${hex}`,
        block,
        fontHasBlock: false,
      });
    }
  }

  return {
    fontFamily: fontEntry.family,
    text,
    missing,
    fullyCovered: missing.length === 0,
  };
}

/**
 * Check coverage for a text string across all available font roles.
 * Returns diagnostics for each role-family that has missing coverage.
 */
export function checkTextCoverage(
  text: string,
  fonts: { body: FontEntry; heading: FontEntry; mono: FontEntry },
): FontCoverageDiagnostic[] {
  const results: FontCoverageDiagnostic[] = [];
  for (const [role, font] of Object.entries(fonts) as Array<[string, FontEntry]>) {
    const diag = checkCoverage(text, font);
    if (!diag.fullyCovered) {
      results.push({
        ...diag,
        fontFamily: `${font.family} (${role})`,
      });
    }
  }
  return results;
}

/**
 * Summarize font coverage information into a human-readable report string.
 */
export function coverageSummary(entry: FontEntry): string {
  const { coverage } = entry;
  return `${entry.family}: ~${coverage.glyphCount} glyphs across ${coverage.blocks.length} blocks.` +
    (coverage.missingBlocks.length > 0
      ? ` Missing: ${coverage.missingBlocks.join(', ')}.`
      : '');
}

/**
 * Generate render diagnostics from coverage checks.
 */
export function coverageRenderDiagnostics(
  diagnostics: FontCoverageDiagnostic[],
): Array<{ code: string; message: string; level: 'warning' | 'error' }> {
  const result: Array<{ code: string; message: string; level: 'warning' | 'error' }> = [];

  for (const diag of diagnostics) {
    if (diag.missing.length === 0) continue;

    const chars = diag.missing.map((m) => `"${m.char}" (${m.codePoint}, ${m.block})`).join(', ');
    result.push({
      code: 'font.missing-glyph-coverage',
      level: 'warning',
      message: `Font "${diag.fontFamily}" does not cover ${diag.missing.length} character(s) in text: ${chars}. ` +
        `These glyphs may render as tofu (□) or missing-glyph boxes.`,
    });
  }

  return result;
}
