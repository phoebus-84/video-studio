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

test("a machine that leaves gives its chunk back, drawn before the rest, and takes nothing more", () => {
  const q = new SegmentQueue(20, [{ host: "a", prior: 1, fromFront: true }, { host: "b", prior: 1 }]);
  q.take("a");
  assert.deepEqual(q.take("b"), [15, 16, 17, 18, 19]);
  q.leave("b");
  assert.equal(q.left, 15, "its segments are counted again");
  assert.deepEqual(q.take("b"), [], "a machine that failed takes nothing");
  assert.deepEqual(q.take("a"), [15, 16, 17, 18, 19], "the chunk given back comes first");
  q.done("a", 1);
  assert.deepEqual(q.take("a"), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(q.left, 0);
});

test("a machine with nothing left waits while others draw, and takes what a failing one gives back", () => {
  const q = new SegmentQueue(6, [{ host: "a", prior: 1, fromFront: true }, { host: "b", prior: 1 }, { host: "c", prior: 1 }]);
  const held = { a: q.take("a"), b: q.take("b"), c: q.take("c") };
  assert.deepEqual(held, { a: [0], b: [5], c: [4] });
  while (q.left > 0) q.done("a", 1), q.take("a");
  q.done("a", 1);
  assert.deepEqual(q.take("a"), [], "nothing left to take now");
  assert.ok(q.mayGetMore("a"), "b and c still hold chunks");
  q.leave("b");
  assert.ok(!q.mayGetMore("b"));
  assert.deepEqual(q.take("a"), [5], "a stopped machine draws the chunk b gave back");
});

test("near the end a slow machine leaves the last seconds to the fast ones, counting what they already drew", () => {
  // A three-machine render at its 86th second: the slow one could take two heavy seconds and keep the others waiting.
  let now = 0;
  const q = new SegmentQueue(35, [
    { host: "local", prior: 0.208, fromFront: true }, { host: "pc", prior: 0.13 }, { host: "server", prior: 0.041 },
  ], () => now);
  assert.equal(q.take("local").length, 10);
  assert.equal(q.take("pc").length, 7);
  assert.equal(q.take("server").length, 2);
  now = 43, q.done("local", 43);
  now = 52, q.take("local");
  now = 86, q.done("server", 76);
  assert.deepEqual(q.take("server"), [], "local and pc have nearly drawn their chunks and finish the rest sooner");
  assert.equal(q.take("server").length, 0, "and it stays stopped");
});

test("a queue over some segments hands out only those, in their order", () => {
  const q = new SegmentQueue([7, 2, 3, 9], [{ host: "a", prior: 1, fromFront: true }, { host: "b", prior: 1 }]);
  assert.ok(q.has("a") && !q.has("c"));
  assert.deepEqual(q.take("a"), [2]);
  assert.deepEqual(q.take("b"), [9]);
  assert.equal(q.left, 2);
  q.done("a", 1);
  q.done("b", 1);
  assert.deepEqual([...q.take("a"), ...q.take("b")].sort((x, y) => x - y), [3, 7]);
});

test("a machine whose segments arrive after the others finish leaves them the last seconds", () => {
  let now = 0;
  const q = new SegmentQueue(12, [{ host: "local", prior: 1, fromFront: true }, { host: "far", prior: 1 }], () => now);
  q.take("local");
  q.done("local", 1); // 3 segments a second
  assert.deepEqual(q.take("far"), [9, 10, 11]);
  now = 1;
  q.done("far", 1, true); // as fast, but its chunk travels 4 s
  now = 5;
  q.confirm("far", [9, 10, 11]);
  q.take("local");
  assert.deepEqual(q.take("far"), [], "local draws the rest before far's next chunk would arrive");
  assert.ok(q.take("local").length > 0);
});
