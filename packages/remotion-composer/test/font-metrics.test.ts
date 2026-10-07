// The bundled faces' widths (lib/font-metrics), which kits fit their text with.
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {fitSize, textWidth} from '../src/kits/lib/font-metrics/1.0.0.js';

const ANTON = {family: 'Anton', weight: 400};

describe('textWidth', () => {
  it('measures with each glyph\'s advance, so wide capitals count wide', () => {
    // Anton: M is 0.746 em, I 0.227 em (the font's own advances)
    assert.ok(Math.abs(textWidth(ANTON, 'M', 100) - 74.6) < 0.1);
    assert.ok(Math.abs(textWidth(ANTON, 'I', 100) - 22.7) < 0.1);
    assert.ok(textWidth(ANTON, 'MMMM', 50) > textWidth(ANTON, 'IIII', 50) * 3);
  });

  it('adds the letter spacing after every character, as CSS does', () => {
    assert.ok(Math.abs(textWidth(ANTON, 'AB', 40, 5) - (textWidth(ANTON, 'AB', 40) + 10)) < 1e-9);
  });

  it('measures Italian accents and typographic quotes, and counts anything else as wide', () => {
    const serif = {family: 'Fraunces', weight: 400, style: 'italic' as const};
    assert.ok(textWidth(serif, 'mostrò', 50) > 0);
    assert.ok(Math.abs(textWidth(serif, '’', 50) - textWidth(serif, "'", 50)) < 10);
    assert.equal(textWidth(ANTON, '漢', 100), 80);
    assert.equal(textWidth({family: 'Garamond', weight: 400}, 'AB', 100), 160);
  });
});

describe('fitSize', () => {
  it('keeps the size when every line fits, and shrinks it until the widest one does', () => {
    assert.equal(fitSize(ANTON, ['IL LAMPO'], 1000, 120), 120);
    const size = fitSize(ANTON, ['MMMMMMMMMMMMMMMMMMMM'], 1000, 150, (s) => s * 0.04);
    assert.ok(textWidth(ANTON, 'MMMMMMMMMMMMMMMMMMMM', size, size * 0.04) <= 1000);
    assert.ok(textWidth(ANTON, 'MMMMMMMMMMMMMMMMMMMM', size + 1, (size + 1) * 0.04) > 1000);
  });
});
