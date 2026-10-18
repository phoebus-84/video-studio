// How many Chrome tabs a render uses when nobody says: as many as free memory
// allows (320 MB each), never more than two thirds of the cores, at least one;
// the operator can force it. A render that starved the machine crashed its
// browser at the same frames until it ran with one tab (avg-dcf.8).

import { describe, expect, it } from "vitest";
import { renderBrowsers, renderConcurrency } from "../src/render-concurrency.js";

const GB = 1024 ** 3;

describe('renderConcurrency', () => {
  it('fits the free memory, 320 MB a tab, at least one', () => {
    expect(renderConcurrency({freeBytes: 0.5 * GB, cpus: 12, env: {}})).toBe(1);
    expect(renderConcurrency({freeBytes: 1.5 * GB, cpus: 12, env: {}})).toBe(4);
    expect(renderConcurrency({freeBytes: 0, cpus: 12, env: {}})).toBe(1);
  });

  it('never takes more than two thirds of the cores', () => {
    // Twelve threads and about 3 GB free: the eight tabs measured fastest.
    expect(renderConcurrency({freeBytes: 3 * GB, cpus: 12, env: {}})).toBe(8);
    expect(renderConcurrency({freeBytes: 64 * GB, cpus: 8, env: {}})).toBe(5);
    expect(renderConcurrency({freeBytes: 64 * GB, cpus: 1, env: {}})).toBe(1);
  });

  it('follows AVG_RENDER_CONCURRENCY when it is a positive whole number', () => {
    expect(renderConcurrency({freeBytes: 1 * GB, cpus: 10, env: {AVG_RENDER_CONCURRENCY: '3'}})).toBe(3);
    expect(renderConcurrency({freeBytes: 0.25 * GB, cpus: 10, env: {AVG_RENDER_CONCURRENCY: 'lots'}})).toBe(1);
    expect(renderConcurrency({freeBytes: 0.25 * GB, cpus: 10, env: {AVG_RENDER_CONCURRENCY: '0'}})).toBe(1);
  });
});

describe('renderBrowsers', () => {
  it('shares the tabs among one browser per two tabs, at most four', () => {
    expect(renderBrowsers({concurrency: 1, env: {}})).toBe(1);
    expect(renderBrowsers({concurrency: 3, env: {}})).toBe(1);
    expect(renderBrowsers({concurrency: 4, env: {}})).toBe(2);
    expect(renderBrowsers({concurrency: 8, env: {}})).toBe(4);
    expect(renderBrowsers({concurrency: 16, env: {}})).toBe(4);
  });

  it('follows AVG_RENDER_BROWSERS, never past one browser a tab', () => {
    expect(renderBrowsers({concurrency: 8, env: {AVG_RENDER_BROWSERS: '1'}})).toBe(1);
    expect(renderBrowsers({concurrency: 2, env: {AVG_RENDER_BROWSERS: '6'}})).toBe(2);
    expect(renderBrowsers({concurrency: 8, env: {AVG_RENDER_BROWSERS: 'many'}})).toBe(4);
  });
});
