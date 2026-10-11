// How many Chrome tabs a render uses when nobody says: as many as free memory
// allows (about 2 GB each), never more than half the cores, at least one; the
// operator can force it. A render that starved the machine crashed its
// browser at the same frames until it ran with one tab (avg-dcf.8).

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {renderConcurrency} from '../src/concurrency.js';

const GB = 1024 ** 3;

describe('renderConcurrency', () => {
  it('fits the free memory, two gigabytes a tab, at least one', () => {
    assert.equal(renderConcurrency({freeBytes: 1.5 * GB, cpus: 10, env: {}}), 1);
    assert.equal(renderConcurrency({freeBytes: 4.5 * GB, cpus: 10, env: {}}), 2);
    assert.equal(renderConcurrency({freeBytes: 0, cpus: 10, env: {}}), 1);
  });

  it('never takes more than half the cores', () => {
    assert.equal(renderConcurrency({freeBytes: 64 * GB, cpus: 8, env: {}}), 4);
    assert.equal(renderConcurrency({freeBytes: 64 * GB, cpus: 1, env: {}}), 1);
  });

  it('follows AVG_RENDER_CONCURRENCY when it is a positive whole number', () => {
    assert.equal(renderConcurrency({freeBytes: 1 * GB, cpus: 10, env: {AVG_RENDER_CONCURRENCY: '3'}}), 3);
    assert.equal(renderConcurrency({freeBytes: 1 * GB, cpus: 10, env: {AVG_RENDER_CONCURRENCY: 'lots'}}), 1);
    assert.equal(renderConcurrency({freeBytes: 1 * GB, cpus: 10, env: {AVG_RENDER_CONCURRENCY: '0'}}), 1);
  });
});
