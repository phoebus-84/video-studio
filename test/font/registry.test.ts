// ── Font registry and diagnostics tests ──

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  FontRegistry,
  createFontRegistry,
  BUNDLED_FONTS,
  LICENSES,
} from '../../src/font/registry.js';
import type { FontEntry } from '../../src/font/registry.js';
import {
  checkCoverage,
  checkTextCoverage,
  coverageSummary,
  coverageRenderDiagnostics,
  findBlock,
} from '../../src/font/diagnostics.js';

// ── Font registry ──

describe('FontRegistry', () => {
  it('is created with bundled fonts', () => {
    const registry = createFontRegistry();
    assert.ok(registry.size >= 3, 'should have at least 3 bundled fonts');
  });

  it('returns bundled font by family name', () => {
    const registry = createFontRegistry();
    const inter = registry.get('Inter');
    assert.ok(inter);
    assert.equal(inter!.family, 'Inter');
    assert.equal(inter!.role, 'body');
    assert.equal(inter!.source, 'bundled');
  });

  it('returns undefined for unknown font (no platform fallback)', () => {
    const registry = createFontRegistry();
    const unknown = registry.get('NonExistentFont12345');
    assert.equal(unknown, undefined);
  });

  it('resolves a font variant by weight and style', () => {
    const registry = createFontRegistry();
    const resolved = registry.resolve('Inter', 400, 'normal');
    assert.ok(resolved);
    assert.equal(resolved!.entry.family, 'Inter');
    assert.equal(resolved!.variant.weight, 400);
    assert.equal(resolved!.variant.style, 'normal');
    assert.ok(resolved!.variant.cssSpec.includes('Inter'));
  });

  it('resolves closest weight variant', () => {
    const registry = createFontRegistry();
    const resolved = registry.resolve('JetBrains Mono', 500, 'normal');
    assert.ok(resolved);
    // Should pick 400 (closest to 500 among {400, 700})
    assert.equal(resolved!.variant.weight, 400);
  });

  it('resolves bold variant', () => {
    const registry = createFontRegistry();
    const resolved = registry.resolve('Inter', 700, 'normal');
    assert.ok(resolved);
    assert.equal(resolved!.variant.weight, 700);
  });

  it('resolves italic variant', () => {
    const registry = createFontRegistry();
    const resolved = registry.resolve('Inter', 400, 'italic');
    assert.ok(resolved);
    assert.equal(resolved!.variant.style, 'italic');
  });

  it('returns undefined for unknown font family', () => {
    const registry = createFontRegistry();
    const resolved = registry.resolve('Arial', 400, 'normal');
    assert.equal(resolved, undefined);
  });

  it('supports injected fonts that override bundled', () => {
    const injectedFont: FontEntry = {
      family: 'Inter',
      displayName: 'Custom Inter',
      license: LICENSES['MIT'],
      source: 'injected',
      role: 'body',
      variants: [
        { weight: 400, style: 'normal', cssSpec: "'Custom Inter', sans-serif" },
      ],
      coverage: {
        glyphCount: 500,
        blocks: ['Basic Latin'],
        missingBlocks: [],
      },
    };
    const registry = createFontRegistry([injectedFont]);
    const resolved = registry.get('Inter');
    assert.ok(resolved);
    assert.equal(resolved!.displayName, 'Custom Inter');
    assert.equal(resolved!.source, 'injected');
  });

  it('lists all registered fonts', () => {
    const registry = createFontRegistry();
    const fonts = registry.list();
    assert.ok(fonts.length >= 3);
    const roles = fonts.map((f) => f.role);
    assert.ok(roles.includes('body'));
    assert.ok(roles.includes('heading'));
    assert.ok(roles.includes('mono'));
  });

  it('has fonts with license metadata', () => {
    for (const font of BUNDLED_FONTS) {
      assert.ok(font.license.id.length > 0, `${font.family} must have license`);
      assert.ok(font.license.name.length > 0, `${font.family} must have license name`);
      assert.equal(font.license.redistributable, true, `${font.family} must be redistributable`);
    }
  });

  it('has fonts with coverage metadata', () => {
    for (const font of BUNDLED_FONTS) {
      assert.ok(font.coverage.glyphCount > 0, `${font.family} must declare glyph count`);
      assert.ok(font.coverage.blocks.includes('Basic Latin'), `${font.family} must cover Basic Latin`);
    }
  });

  it('is deterministic', () => {
    const r1 = createFontRegistry();
    const r2 = createFontRegistry();
    assert.equal(r1.size, r2.size);
    for (const f1 of r1.list()) {
      const f2 = r2.get(f1.family);
      assert.ok(f2, `${f1.family} should be in both registries`);
    }
  });
});

// ── Font diagnostics ──

describe('findBlock', () => {
  it('identifies Basic Latin', () => {
    assert.equal(findBlock('A'.codePointAt(0)!), 'Basic Latin');
  });

  it('identifies CJK', () => {
    assert.equal(findBlock('字'.codePointAt(0)!), 'CJK Unified Ideographs');
  });

  it('identifies Arabic', () => {
    assert.equal(findBlock('ا'.codePointAt(0)!), 'Arabic');
  });

  it('returns Unknown for unmapped code points', () => {
    // Private use area
    assert.equal(findBlock(0xE000), 'Unknown');
  });
});

describe('checkCoverage', () => {
  it('passes for Latin text with Inter', () => {
    const inter = BUNDLED_FONTS.find((f) => f.family === 'Inter')!;
    const diag = checkCoverage('Hello World 123', inter);
    assert.equal(diag.fullyCovered, true);
    assert.equal(diag.missing.length, 0);
  });

  it('detects CJK characters not covered by Inter', () => {
    const inter = BUNDLED_FONTS.find((f) => f.family === 'Inter')!;
    const diag = checkCoverage('Hello 世界', inter);
    assert.equal(diag.fullyCovered, false);
    assert.ok(diag.missing.length >= 1);
    assert.equal(diag.missing[0].fontHasBlock, false);
    assert.match(diag.missing[0].codePoint, /^U\+[0-9A-F]+$/);
  });

  it('detects Arabic text not covered by JetBrains Mono', () => {
    const jbm = BUNDLED_FONTS.find((f) => f.family === 'JetBrains Mono')!;
    const diag = checkCoverage('مرحبا', jbm);
    assert.equal(diag.fullyCovered, false);
    assert.ok(diag.missing.length >= 1);
  });

  it('includes character and block info for missing glyphs', () => {
    const inter = BUNDLED_FONTS.find((f) => f.family === 'Inter')!;
    const diag = checkCoverage('Hi 字', inter);
    const miss = diag.missing.find((m) => m.char === '字');
    assert.ok(miss);
    assert.match(miss!.codePoint, /^U\+/);
    assert.ok(miss!.block.length > 0);
  });

  it('is deterministic', () => {
    const inter = BUNDLED_FONTS.find((f) => f.family === 'Inter')!;
    const d1 = checkCoverage('Hello 世界', inter);
    const d2 = checkCoverage('Hello 世界', inter);
    assert.deepEqual(d1, d2);
  });
});

describe('checkTextCoverage', () => {
  it('checks coverage across all font roles', () => {
    const body = BUNDLED_FONTS.find((f) => f.role === 'body')!;
    const heading = BUNDLED_FONTS.find((f) => f.role === 'heading')!;
    const mono = BUNDLED_FONTS.find((f) => f.role === 'mono')!;
    const results = checkTextCoverage('Hello 世界', { body, heading, mono });
    // All non-CJK fonts will have missing coverage for 世界
    assert.ok(results.length >= 1);
    for (const r of results) {
      assert.ok(r.missing.length >= 1);
    }
  });
});

describe('coverageSummary', () => {
  it('produces a human-readable summary', () => {
    const inter = BUNDLED_FONTS.find((f) => f.family === 'Inter')!;
    const summary = coverageSummary(inter);
    assert.ok(summary.includes('Inter'));
    assert.ok(summary.includes('glyphs'));
  });
});

describe('coverageRenderDiagnostics', () => {
  it('converts coverage diagnostics to render diagnostics', () => {
    const inter = BUNDLED_FONTS.find((f) => f.family === 'Inter')!;
    const covDiag = checkCoverage('Hello 世界', inter);
    const renderDiags = coverageRenderDiagnostics([covDiag]);
    assert.ok(renderDiags.length >= 1);
    assert.equal(renderDiags[0].level, 'warning');
    assert.match(renderDiags[0].code, /font\./);
    assert.ok(renderDiags[0].message.includes('Inter'));
  });

  it('returns empty for fully covered text', () => {
    const inter = BUNDLED_FONTS.find((f) => f.family === 'Inter')!;
    const covDiag = checkCoverage('Hello World', inter);
    const renderDiags = coverageRenderDiagnostics([covDiag]);
    assert.equal(renderDiags.length, 0);
  });
});

// ── License integrity ──

describe('Font licenses', () => {
  it('all bundled fonts are redistributable', () => {
    for (const font of BUNDLED_FONTS) {
      assert.equal(
        font.license.redistributable,
        true,
        `${font.family} license must allow redistribution`,
      );
    }
  });

  it('all bundled fonts use SIL OFL 1.1', () => {
    for (const font of BUNDLED_FONTS) {
      assert.equal(
        font.license.id,
        'SIL-OFL-1.1',
        `${font.family} must use SIL Open Font License 1.1`,
      );
    }
  });

  it('licenses include reference URLs', () => {
    for (const font of BUNDLED_FONTS) {
      assert.ok(
        font.license.reference.length > 0,
        `${font.family} license must have a reference URL`,
      );
    }
  });
});
