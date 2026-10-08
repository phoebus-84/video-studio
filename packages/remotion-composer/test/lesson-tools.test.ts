// What the teaching tools place and fit with (lib/lesson-tools): points on a framed picture, lines on plates.
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {textWidth} from '../src/kits/lib/font-metrics/1.0.0.js';
import {coverPoint, fitLine} from '../src/kits/lib/lesson-tools/1.0.0.js';

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
