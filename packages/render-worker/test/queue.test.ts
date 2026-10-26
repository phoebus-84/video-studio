// SegmentQueue on its own: chunk sizes, directions, and when a machine stops.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SegmentQueue } from "../src/queue.js";

test("first chunks are half a machine's fair part, from either end", () => {
  const q = new SegmentQueue(20, [{ host: "a", prior: 1, fromFront: true }, { host: "b", prior: 1 }]);
  assert.deepEqual(q.take("a"), [0, 1, 2, 3, 4]);
  assert.deepEqual(q.take("b"), [15, 16, 17, 18, 19]);
  assert.equal(q.left, 10);
});

test("chunks shrink and the queue empties, every segment once", () => {
  const q = new SegmentQueue(30, [{ host: "a", prior: 1, fromFront: true }, { host: "b", prior: 1 }]);
  const seen: number[] = [];
  for (let round = 0; q.left > 0 && round < 100; round++) {
    for (const host of ["a", "b"]) {
      const chunk = q.take(host);
      seen.push(...chunk);
      q.done(host, chunk.length);
    }
  }
  assert.deepEqual(seen.sort((x, y) => x - y), Array.from({ length: 30 }, (_, i) => i));
});

test("a slow machine stops rather than take what the others finish sooner", () => {
  const q = new SegmentQueue(10, [{ host: "fast", prior: 1, fromFront: true }, { host: "slow", prior: 1 }]);
  q.take("fast");
  q.done("fast", 1); // 3 segments a second
  q.take("slow");
  q.done("slow", 100); // 0.03
  assert.deepEqual(q.take("slow"), [], "it would finish a segment long after fast drew them all");
  assert.deepEqual(q.take("slow"), [], "and stays stopped");
  assert.equal(q.take("fast").length > 0, true);
});

test("a machine alone takes everything left", () => {
  const q = new SegmentQueue(6, [{ host: "a", prior: 1 }, { host: "b", prior: 1, fromFront: true }]);
  assert.deepEqual(q.take("b"), [0, 1]);
  q.done("b", 1);
  assert.deepEqual(q.take("a"), [5]);
  q.done("a", 1000);
  assert.deepEqual(q.take("a"), [], "too slow beside b");
  assert.deepEqual(q.take("b"), [2, 3, 4]);
});

test("an unmeasured machine's prior is scaled like the measured ones", () => {
  const q = new SegmentQueue(100, [{ host: "a", prior: 2, fromFront: true }, { host: "b", prior: 1 }]);
  q.take("a");
  q.done("a", 10);
  // a: 34 segments in 10 s, 1.7 times its prior; b is expected at 1.7 × 1.
  assert.ok(Math.abs(q.rate({ prior: 1, segments: 0, seconds: 0 }) - 1.7) < 1e-9);
  assert.throws(() => q.take("c"), /does not draw/);
});
