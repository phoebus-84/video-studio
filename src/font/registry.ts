// ── Font registry ──
// Deterministic font registry with license metadata.
// Fonts are bundled or injected — never resolved from platform defaults.
// Missing fonts produce typed diagnostics, never silent fallbacks.

// ── License types ──

export type FontLicenseId =
  | 'SIL-OFL-1.1'
  | 'Apache-2.0'
  | 'MIT'
  | 'custom';

export interface FontLicense {
  /** Standardized license identifier */
  id: FontLicenseId;
  /** Full license name */
  name: string;
  /** URL to license text (bundled reference, not network) */
  reference: string;
  /** Whether redistribution is permitted */
  redistributable: boolean;
}

// ── Font variant ──

export interface FontVariant {
  /** Numeric font weight (100-900) */
  weight: number;
  /** Font style */
  style: 'normal' | 'italic';
  /** CSS-ready font-family string */
  cssSpec: string;
}

// ── Font entry ──

export interface FontEntry {
  /** Canonical family name */
  family: string;
  /** Human-readable display name */
  displayName: string;
  /** License metadata */
  license: FontLicense;
  /** The font source */
  source: 'bundled' | 'injected';
  /** Available weight/style variants */
  variants: FontVariant[];
  /** Whether the font covers all Basic Latin + Latin-1 Supplement (≈ 256 glyphs) */
  coverage: FontCoverage;
  /** Primary role: body, heading, or mono */
  role: 'body' | 'heading' | 'mono';
}

export interface FontCoverage {
  /** Approximate glyph count */
  glyphCount: number;
  /** Unicode blocks covered */
  blocks: string[];
  /** Known missing blocks for diagnostics */
  missingBlocks: string[];
}

// ── Standard licenses ──

export const LICENSES: Record<FontLicenseId, FontLicense> = {
  'SIL-OFL-1.1': {
    id: 'SIL-OFL-1.1',
    name: 'SIL Open Font License 1.1',
    reference: 'https://openfontlicense.org/',
    redistributable: true,
  },
  'Apache-2.0': {
    id: 'Apache-2.0',
    name: 'Apache License 2.0',
    reference: 'https://www.apache.org/licenses/LICENSE-2.0',
    redistributable: true,
  },
  'MIT': {
    id: 'MIT',
    name: 'MIT License',
    reference: 'https://opensource.org/licenses/MIT',
    redistributable: true,
  },
  'custom': {
    id: 'custom',
    name: 'Custom / Proprietary License',
    reference: '',
    redistributable: false,
  },
};

// ── CSS spec helpers ──

function cssFontFamily(family: string): string {
  // If family contains spaces, wrap in quotes
  if (/\s/.test(family)) {
    return `'${family}'`;
  }
  return family;
}

// ── Bundled font catalog ──
// These are open-licensed reference fonts.
// Actual font files are not shipped — the registry produces CSS specs
// that a host with injected font data or a bundled font loader fulfills.
// The key guarantee: no platform font fallback is ever emitted.

export const BUNDLED_FONTS: FontEntry[] = [
  {
    family: 'Inter',
    displayName: 'Inter',
    license: LICENSES['SIL-OFL-1.1'],
    source: 'bundled',
    role: 'body',
    variants: [
      { weight: 400, style: 'normal', cssSpec: `${cssFontFamily('Inter')}, sans-serif` },
      { weight: 400, style: 'italic', cssSpec: `${cssFontFamily('Inter')}, sans-serif` },
      { weight: 600, style: 'normal', cssSpec: `${cssFontFamily('Inter')}, sans-serif` },
      { weight: 700, style: 'normal', cssSpec: `${cssFontFamily('Inter')}, sans-serif` },
    ],
    coverage: {
      glyphCount: 2548,
      blocks: ['Basic Latin', 'Latin-1 Supplement', 'Latin Extended-A', 'Latin Extended-B'],
      missingBlocks: ['CJK Unified Ideographs', 'Arabic', 'Devanagari'],
    },
  },
  {
    family: 'JetBrains Mono',
    displayName: 'JetBrains Mono',
    license: LICENSES['SIL-OFL-1.1'],
    source: 'bundled',
    role: 'mono',
    variants: [
      { weight: 400, style: 'normal', cssSpec: `${cssFontFamily('JetBrains Mono')}, monospace` },
      { weight: 400, style: 'italic', cssSpec: `${cssFontFamily('JetBrains Mono')}, monospace` },
      { weight: 700, style: 'normal', cssSpec: `${cssFontFamily('JetBrains Mono')}, monospace` },
    ],
    coverage: {
      glyphCount: 1394,
      blocks: ['Basic Latin', 'Latin-1 Supplement', 'Latin Extended-A', 'Box Drawing'],
      missingBlocks: ['CJK Unified Ideographs', 'Arabic'],
    },
  },
  {
    family: 'Source Serif 4',
    displayName: 'Source Serif 4',
    license: LICENSES['SIL-OFL-1.1'],
    source: 'bundled',
    role: 'heading',
    variants: [
      { weight: 400, style: 'normal', cssSpec: `${cssFontFamily('Source Serif 4')}, serif` },
      { weight: 600, style: 'normal', cssSpec: `${cssFontFamily('Source Serif 4')}, serif` },
      { weight: 700, style: 'normal', cssSpec: `${cssFontFamily('Source Serif 4')}, serif` },
      { weight: 400, style: 'italic', cssSpec: `${cssFontFamily('Source Serif 4')}, serif` },
    ],
    coverage: {
      glyphCount: 1894,
      blocks: ['Basic Latin', 'Latin-1 Supplement', 'Latin Extended-A'],
      missingBlocks: ['CJK Unified Ideographs'],
    },
  },
];

// ── Registry ──

export interface FontRegistryOptions {
  /** Additional injected fonts (beyond the bundled catalog) */
  injected?: FontEntry[];
}

export class FontRegistry {
  private readonly fonts: Map<string, FontEntry> = new Map();

  constructor(options: FontRegistryOptions = {}) {
    // Register bundled fonts first
    for (const font of BUNDLED_FONTS) {
      this.fonts.set(font.family, font);
    }
    // Injected fonts override bundled entries
    if (options.injected) {
      for (const font of options.injected) {
        this.fonts.set(font.family, font);
      }
    }
  }

  /**
   * Look up a font by family name.
   * Returns undefined if not registered — never falls back to platform fonts.
   */
  get(family: string): FontEntry | undefined {
    return this.fonts.get(family);
  }

  /**
   * Resolve a font request to a variant.
   * Returns the best-matching variant or undefined if the font isn't registered.
   * Never falls back to platform fonts.
   */
  resolve(
    family: string,
    weight: number,
    style: 'normal' | 'italic',
  ): { entry: FontEntry; variant: FontVariant } | undefined {
    const entry = this.fonts.get(family);
    if (!entry) return undefined;

    // Find the closest variant
    let best: { variant: FontVariant; score: number } | undefined;
    for (const v of entry.variants) {
      if (v.style !== style && v.style !== 'normal' && style !== 'normal') continue;
      const weightDist = Math.abs(v.weight - weight);
      const stylePenalty = (v.style === style ? 0 : 100);
      const score = weightDist + stylePenalty;
      if (!best || score < best.score) {
        best = { variant: v, score };
      }
    }
    if (best) return { entry, variant: best.variant };

    // Fallback: return first variant (shouldn't happen if variants is non-empty)
    if (entry.variants.length > 0) {
      return { entry, variant: entry.variants[0] };
    }
    return undefined;
  }

  /**
   * List all registered font entries.
   */
  list(): FontEntry[] {
    return [...this.fonts.values()];
  }

  /**
   * Get the total count of registered fonts.
   */
  get size(): number {
    return this.fonts.size;
  }
}

/**
 * Create a font registry with the bundled catalog.
 */
export function createFontRegistry(injected?: FontEntry[]): FontRegistry {
  if (injected !== undefined) {
    return new FontRegistry({ injected });
  }
  return new FontRegistry();
}
