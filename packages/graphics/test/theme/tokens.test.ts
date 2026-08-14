// ── Theme design tokens tests ──

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { VISUAL_BIBLE_DARK, resolveTheme } from '../../src/theme/tokens.js';
import {
  contrastRatio,
  relativeLuminance,
  wcagLevel,
  checkPair,
  checkPaletteContrast,
  contrastDiagnostics,
} from '../../src/theme/contrast.js';
import {
  SAFE_AREA_PROFILES,
  DEFAULT_SAFE_AREA_PROFILE,
  resolveProfile,
  computePixelSafeArea,
  bestFitProfile,
} from '../../src/theme/profile.js';

// ── Design tokens ──

describe('Visual Bible Dark tokens', () => {
  it('has a valid palette with all required colors', () => {
    const p = VISUAL_BIBLE_DARK.palette;
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    assert.match(p.background, hexRe);
    assert.match(p.foreground, hexRe);
    assert.match(p.primary, hexRe);
    assert.match(p.secondary, hexRe);
    assert.match(p.accent, hexRe);
    assert.match(p.muted, hexRe);
    assert.match(p.border, hexRe);
  });

  it('has semantic colors defined', () => {
    const s = VISUAL_BIBLE_DARK.palette.semantic;
    assert.ok(s.success.length > 0);
    assert.ok(s.warning.length > 0);
    assert.ok(s.error.length > 0);
    assert.ok(s.info.length > 0);
    assert.ok(s.highlight.length > 0);
    assert.ok(s.dimmed.length > 0);
    assert.ok(s.surface.length > 0);
  });

  it('has a valid type scale with increasing sizes', () => {
    const ts = VISUAL_BIBLE_DARK.typeScale;
    assert.ok(ts.xs > 0);
    assert.ok(ts.sm > ts.xs);
    assert.ok(ts.base > ts.sm);
    assert.ok(ts.md > ts.base);
    assert.ok(ts.lg > ts.md);
    assert.ok(ts.xl > ts.lg);
    assert.ok(ts['2xl'] > ts.xl);
    assert.ok(ts['3xl'] > ts['2xl']);
  });

  it('has a valid spacing scale', () => {
    const sp = VISUAL_BIBLE_DARK.spacing;
    assert.equal(sp.unit, 8);
    assert.ok(sp.xs > 0);
    assert.ok(sp.sm > sp.xs);
    assert.ok(sp.md > sp.sm);
    assert.ok(sp.lg > sp.md);
    assert.ok(sp.xl > sp.lg);
    assert.ok(sp['2xl'] > sp.xl);
  });

  it('has valid stroke tokens', () => {
    const st = VISUAL_BIBLE_DARK.stroke;
    assert.ok(st.hairline > 0);
    assert.ok(st.regular > st.hairline);
    assert.ok(st.emphasis > st.regular);
  });

  it('has valid corner tokens', () => {
    const c = VISUAL_BIBLE_DARK.corner;
    assert.equal(c.none, 0);
    assert.ok(c.sm > 0);
    assert.ok(c.md > c.sm);
    assert.ok(c.lg > c.md);
    assert.ok(c.full > c.lg);
  });

  it('includes theme provenance', () => {
    const p = VISUAL_BIBLE_DARK.provenance;
    assert.equal(p.themeId, 'visual-bible-dark');
    assert.equal(p.version, '1.0.0');
    assert.equal(p.source, 'bundled');
    assert.match(p.pinnedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('resolveTheme', () => {
  it('returns bundled theme when no themeId given', () => {
    const theme = resolveTheme();
    assert.equal(theme.provenance.themeId, 'visual-bible-dark');
  });

  it('returns bundled theme for known themeId', () => {
    const theme = resolveTheme('visual-bible-dark');
    assert.equal(theme.provenance.themeId, 'visual-bible-dark');
  });

  it('returns default for unrecognized themeId (caller must diagnose)', () => {
    const theme = resolveTheme('nonexistent-v2');
    // Returns default; pipeline emits diagnostic for unrecognized themes
    assert.equal(theme.provenance.themeId, 'visual-bible-dark');
  });

  it('is deterministic', () => {
    const a = resolveTheme();
    const b = resolveTheme();
    assert.deepEqual(a, b);
  });
});

// ── Contrast ──

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    const ratio = contrastRatio('#000000', '#ffffff');
    assert.ok(ratio > 20);
    assert.ok(ratio <= 21);
  });

  it('returns 1 for identical colors', () => {
    assert.equal(contrastRatio('#ff0000', '#ff0000'), 1);
  });

  it('is commutative', () => {
    const r1 = contrastRatio('#1a1a2e', '#e0e0e0');
    const r2 = contrastRatio('#e0e0e0', '#1a1a2e');
    assert.equal(r1.toFixed(4), r2.toFixed(4));
  });

  it('detects low contrast for muted text on dark background', () => {
    const ratio = contrastRatio('#6c6c80', '#1a1a2e');
    assert.ok(ratio < 4.5, `muted/background should have low contrast, got ${ratio}`);
    assert.ok(ratio > 1);
  });
});

describe('relativeLuminance', () => {
  it('returns 0 for pure black', () => {
    assert.equal(relativeLuminance('#000000'), 0);
  });

  it('returns 1 for pure white', () => {
    assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 0.001);
  });

  it('is deterministic', () => {
    assert.equal(relativeLuminance('#7b68ee'), relativeLuminance('#7b68ee'));
  });
});

describe('wcagLevel', () => {
  it('returns AAA for ratio >= 7', () => {
    assert.equal(wcagLevel(7.0), 'AAA');
    assert.equal(wcagLevel(21), 'AAA');
  });

  it('returns AA for ratio >= 4.5', () => {
    assert.equal(wcagLevel(4.5), 'AA');
    assert.equal(wcagLevel(6.9), 'AA');
  });

  it('returns AA-Large for ratio >= 3 with large text', () => {
    assert.equal(wcagLevel(3.0, true), 'AA-Large');
    assert.equal(wcagLevel(4.4, true), 'AA-Large');
  });

  it('returns fail for ratio < 4.5 (normal text)', () => {
    assert.equal(wcagLevel(3.0), 'fail');
    assert.equal(wcagLevel(2.0), 'fail');
  });
});

describe('checkPair', () => {
  it('produces a valid contrast result', () => {
    const result = checkPair('#ffffff', '#000000', 'test-pair');
    assert.equal(result.pair, 'test-pair');
    assert.ok(result.ratio > 20);
    assert.equal(result.level, 'AAA');
  });

  it('flags low-contrast pairs', () => {
    const result = checkPair('#6c6c80', '#1a1a2e', 'muted/bg');
    assert.equal(result.level, 'fail');
  });
});

describe('checkPaletteContrast', () => {
  it('produces a comprehensive report for the bundled palette', () => {
    const report = checkPaletteContrast(VISUAL_BIBLE_DARK.palette);
    assert.ok(report.results.length > 5, 'should check at least several pairs');
    assert.equal(report.paletteId.length > 0, true);
  });

  it('identifies low-contrast muted pairs', () => {
    const report = checkPaletteContrast(VISUAL_BIBLE_DARK.palette);
    // muted/background should be a failure or at least low
    const mutedPair = report.results.find((r) => r.pair === 'muted/background');
    assert.ok(mutedPair, 'should check muted/background');
    assert.ok(mutedPair!.ratio < 4.5, 'muted should be low contrast by design');
  });
});

describe('contrastDiagnostics', () => {
  it('emits info diagnostics for failing pairs', () => {
    const report = checkPaletteContrast(VISUAL_BIBLE_DARK.palette);
    const diags = contrastDiagnostics(report);
    // All diagnostics should be info level (not blocking)
    for (const d of diags) {
      assert.equal(d.level, 'info');
      assert.match(d.code, /contrast\./);
      assert.ok(d.message.length > 0);
    }
  });

  it('diagnostics are deterministic', () => {
    const r1 = checkPaletteContrast(VISUAL_BIBLE_DARK.palette);
    const r2 = checkPaletteContrast(VISUAL_BIBLE_DARK.palette);
    assert.deepEqual(contrastDiagnostics(r1), contrastDiagnostics(r2));
  });
});

// ── Profiles ──

describe('safe area profiles', () => {
  it('defines a 16:9 default profile', () => {
    const p = SAFE_AREA_PROFILES['16:9'];
    assert.equal(p.id, '16:9');
    assert.ok(p.aspectRatio > 1.7 && p.aspectRatio < 1.8);
    assert.ok(p.topFraction > 0 && p.topFraction < 1);
  });

  it('defines all expected profiles', () => {
    const ids = Object.keys(SAFE_AREA_PROFILES);
    assert.ok(ids.includes('16:9'));
    assert.ok(ids.includes('4:3'));
    assert.ok(ids.includes('1:1'));
    assert.ok(ids.includes('9:16'));
  });

  it('default profile is 16:9', () => {
    assert.equal(DEFAULT_SAFE_AREA_PROFILE.id, '16:9');
  });
});

describe('resolveProfile', () => {
  it('returns 16:9 by default', () => {
    const p = resolveProfile();
    assert.equal(p!.id, '16:9');
  });

  it('returns requested profile when valid', () => {
    const p = resolveProfile('1:1');
    assert.equal(p!.id, '1:1');
    assert.equal(p!.aspectRatio, 1);
  });

  it('returns undefined for unknown profile', () => {
    assert.equal(resolveProfile('21:9'), undefined);
  });
});

describe('computePixelSafeArea', () => {
  it('computes correct pixel insets for 16:9 1920×1080', () => {
    const p = SAFE_AREA_PROFILES['16:9'];
    const sa = computePixelSafeArea(p, 1920, 1080);
    // 4% safe area → 43px top/bottom, 77px left/right
    assert.equal(sa.top, 43);
    assert.equal(sa.bottom, 43);
    assert.equal(sa.left, 77);
    assert.equal(sa.right, 77);
  });

  it('computes symmetric insets for square profile', () => {
    const p = SAFE_AREA_PROFILES['1:1'];
    const sa = computePixelSafeArea(p, 1000, 1000);
    assert.equal(sa.top, 60);
    assert.equal(sa.bottom, 60);
    assert.equal(sa.left, 60);
    assert.equal(sa.right, 60);
  });
});

describe('bestFitProfile', () => {
  it('matches 16:9 dimensions', () => {
    const p = bestFitProfile(1920, 1080);
    assert.equal(p.id, '16:9');
  });

  it('matches 1:1 dimensions', () => {
    const p = bestFitProfile(800, 800);
    assert.equal(p.id, '1:1');
  });

  it('matches 4:3 dimensions', () => {
    const p = bestFitProfile(1024, 768);
    assert.equal(p.id, '4:3');
  });

  it('returns default for invalid dimensions', () => {
    const p = bestFitProfile(-1, 100);
    assert.equal(p.id, '16:9');
  });
});
