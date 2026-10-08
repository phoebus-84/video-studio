// What the teaching tools place and fit with (lib/lesson-tools): points on a framed picture, lines on plates.
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {textWidth} from '../src/kits/lib/font-metrics/1.0.0.js';
import {chipSize, coverPoint, fitLine, labelLines, verseTokens} from '../src/kits/lib/lesson-tools/1.0.0.js';

const near = (a: readonly number[], b: readonly number[]) => a.every((x, i) => Math.abs(x - b[i]!) < 1e-6);

describe('coverPoint', () => {
  const box = {x: 100, y: 50, w: 1000, h: 500};
  it('maps a picture of the box\'s own aspect onto the box', () => {
    assert.ok(near(coverPoint(box, 2, 1, 0.5, 0.5, 1, 0, 0), [100, 50]));
    assert.ok(near(coverPoint(box, 2, 1, 0.5, 0.5, 1, 1, 1), [1100, 550]));
  });
  it('crops a taller picture around its focus: the focus point stays where object-position puts it', () => {
    // a 4:3 picture covering a 2:1 box is 1000×750: 250 px are cropped, shared by the focus
    assert.ok(near(coverPoint(box, 4, 3, 0.5, 0, 1, 0.5, 0), [600, 50]));
    assert.ok(near(coverPoint(box, 4, 3, 0.5, 1, 1, 0.5, 1), [600, 550]));
    assert.ok(near(coverPoint(box, 4, 3, 0.5, 0.5, 1, 0.5, 0.5), [600, 300]));
  });
  it('zooms about the focus: the focus stays put, other points move away from it', () => {
    assert.ok(near(coverPoint(box, 4, 3, 0.3, 0.4, 2, 0.3, 0.4), coverPoint(box, 4, 3, 0.3, 0.4, 1, 0.3, 0.4)));
    const [x1] = coverPoint(box, 4, 3, 0.5, 0.5, 1, 0.6, 0.5);
    const [x2] = coverPoint(box, 4, 3, 0.5, 0.5, 2, 0.6, 0.5);
    assert.ok(Math.abs(x2 - 600 - 2 * (x1 - 600)) < 1e-6);
  });
});

describe('fitLine', () => {
  const face = {family: 'Anton', weight: 400};
  it('keeps the size that fits', () => {
    assert.equal(fitLine(face, ['SKY'], 1000, 64), 64);
  });
  it('shrinks a line until it fits with its spacing and its plate', () => {
    const line = 'A TITLE FAR TOO LONG FOR ITS ROOM';
    const size = fitLine(face, [line], 600, 64, () => 2, (s) => s * 0.64 + 48);
    assert.ok(size < 64);
    assert.ok(textWidth(face, line, size, 2) + size * 0.64 + 48 <= 600);
    assert.ok(textWidth(face, line, size + 0.5, 2) + (size + 0.5) * 0.64 + 48 > 600);
  });
  it('fits every line given', () => {
    const size = fitLine(face, ['SHORT', 'A MUCH LONGER LINE OF TEXT'], 300, 64);
    assert.ok(textWidth(face, 'A MUCH LONGER LINE OF TEXT', size) <= 300);
  });
});

describe('coverPoint on a wider picture', () => {
  it('crops it sideways around its focus', () => {
    // a 4:1 picture covering a 2:1 box is 2000×500: 1000 px are cropped, shared by the focus
    const box = {x: 0, y: 0, w: 1000, h: 500};
    assert.ok(near(coverPoint(box, 4, 1, 0.25, 0.5, 1, 0.25, 0.5), [250, 250]));
    assert.ok(near(coverPoint(box, 4, 1, 0, 0.5, 1, 0, 0), [0, 0]));
    assert.ok(near(coverPoint(box, 4, 1, 1, 0.5, 1, 1, 1), [1000, 500]));
  });
});

describe('fitLine when nothing fits', () => {
  it('returns its smallest size rather than failing', () => {
    assert.equal(Math.round(fitLine({family: 'Anton', weight: 400}, ['M'], 0, 64)), 1);
  });
});

describe('verseTokens', () => {
  it('counts a word by its letters and digits, and reads the punctuation after it', () => {
    assert.deepEqual(verseTokens("s'aprì si chiuse, nella notte nera."), [
      {len: 5, p: ''}, {len: 2, p: ''}, {len: 6, p: ','}, {len: 5, p: ''}, {len: 5, p: ''}, {len: 4, p: '.'},
    ]);
  });
  it('sees punctuation behind closing quotes, and skips tokens with no letter', () => {
    assert.deepEqual(verseTokens('«nera.» — 1894;'), [{len: 4, p: '.'}, {len: 4, p: ';'}]);
  });
});

describe('labelLines', () => {
  it('puts each label on the first line where it touches nothing, adding lines as needed', () => {
    // three labels 60 px wide, 10 px apart: they need three lines
    assert.deepEqual(labelLines([0, 10, 20], [60, 60, 60], 10), [0, 1, 2]);
    assert.deepEqual(labelLines([0, 200, 400], [60, 60, 60], 10), [0, 0, 0]);
    assert.deepEqual(labelLines([0, 10, 200], [60, 60, 60], 10), [0, 1, 0]);
  });
  it('places twelve close labels on twelve lines without overlap', () => {
    const lines = labelLines(Array.from({length: 12}, (_, i) => i * 5), Array(12).fill(60), 10);
    assert.equal(new Set(lines).size, 12);
  });
});

describe('chipSize', () => {
  const face = {family: 'Inter', weight: 400};
  it('measures the text, so the chip holds it', () => {
    const {size, width} = chipSize(face, 'IL CIELO E LA TERRA', 44, 2000);
    assert.equal(size, 44);
    assert.ok(Math.abs(width - (textWidth(face, 'IL CIELO E LA TERRA', 44, 44 * 0.12) + 44 * 1.6)) < 1e-6);
  });
  it('shrinks a text too long for its room', () => {
    const {size, width} = chipSize(face, 'MMMMMMMMMMMMMMMMMMMMMM', 44, 900);
    assert.ok(size < 44);
    assert.ok(width <= 900);
  });
});
