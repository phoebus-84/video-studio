// ── Content hash tests ──

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeContentHash,
  generateStableId,
  contentHashEquals,
  sortObjectKeys,
} from '../../src/hashing/content-hash.js';

describe('computeContentHash', () => {
  it('produces a canonical sha256-prefixed digest for any input', () => {
    const h = computeContentHash({ hello: 'world' });
    assert.equal(h.length, 71);
    assert.match(h, /^sha256:[0-9a-f]{64}$/);
  });

  it('is deterministic — same input produces same hash', () => {
    const obj = { a: 1, b: [2, 3], c: { d: 'e' } };
    const h1 = computeContentHash(obj);
    const h2 = computeContentHash(obj);
    assert.equal(h1, h2);
  });

  it('is stable across object key orders', () => {
    const h1 = computeContentHash({ a: 1, b: 2 });
    const h2 = computeContentHash({ b: 2, a: 1 });
    assert.equal(h1, h2);
  });

  it('is stable across Map and Set inputs', () => {
    const m1 = new Map([['b', 2], ['a', 1]]);
    const m2 = new Map([['a', 1], ['b', 2]]);
    assert.equal(computeContentHash(m1), computeContentHash(m2));
  });

  it('produces different hashes for different values', () => {
    const h1 = computeContentHash({ x: 1 });
    const h2 = computeContentHash({ x: 2 });
    assert.notEqual(h1, h2);
  });

  it('normalizes undefined values to null in canonical form', () => {
    // undefined values are normalized to null, so {a:1, b:undefined}
    // becomes {"a":1,"b":null} which differs from {"a":1}
    const h1 = computeContentHash({ a: 1, b: undefined });
    const h2 = computeContentHash({ a: 1, b: null });
    assert.equal(h1, h2);
    // But is different from {a:1} without the key
    const h3 = computeContentHash({ a: 1 });
    assert.notEqual(h1, h3);
  });

  it('handles primitive values', () => {
    assert.equal(computeContentHash('hello'), computeContentHash('hello'));
    assert.equal(computeContentHash(42), computeContentHash(42));
    assert.notEqual(computeContentHash(42), computeContentHash(43));
  });

  it('handles null values', () => {
    assert.equal(computeContentHash(null), computeContentHash(null));
    assert.notEqual(computeContentHash(null), computeContentHash({}));
  });
});

describe('generateStableId', () => {
  it('produces an ID with the given prefix', () => {
    const id = generateStableId('gr', { test: true });
    assert.match(id, /^gr_[0-9a-f]{32}$/);
  });

  it('produces the same ID for the same input', () => {
    const input = { kind: 'code-frame', code: 'const x = 1;' };
    const id1 = generateStableId('gr', input);
    const id2 = generateStableId('gr', input);
    assert.equal(id1, id2);
  });

  it('produces different IDs for different inputs', () => {
    const id1 = generateStableId('gr', { a: 1 });
    const id2 = generateStableId('gr', { a: 2 });
    assert.notEqual(id1, id2);
  });

  it('uses the prefix as the type segment', () => {
    const id = generateStableId('ep', { x: 'y' });
    assert.match(id, /^ep_/);
  });
});

describe('contentHashEquals', () => {
  it('returns true for equal values', () => {
    assert.equal(contentHashEquals({ a: 1 }, { a: 1 }), true);
  });

  it('returns false for different values', () => {
    assert.equal(contentHashEquals({ a: 1 }, { a: 2 }), false);
  });

  it('returns true regardless of key order', () => {
    assert.equal(contentHashEquals({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  });
});

describe('sortObjectKeys', () => {
  it('sorts object keys alphabetically', () => {
    const sorted = sortObjectKeys({ c: 3, a: 1, b: 2 });
    assert.deepEqual(Object.keys(sorted), ['a', 'b', 'c']);
  });

  it('preserves values', () => {
    const sorted = sortObjectKeys({ z: 'last', a: 'first' });
    assert.equal(sorted.a, 'first');
    assert.equal(sorted.z, 'last');
  });
});
