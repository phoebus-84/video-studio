import { expect, test } from "vitest";
import { computeDiff } from "$lib/diff";

test("identical texts produce empty diff", () => {
  const hunks = computeDiff("line 1\nline 2", "line 1\nline 2");
  /* All lines are same — one hunk with two same lines. */
  expect(hunks.length).toBe(1);
  expect(hunks[0]!.lines.every((l) => l.tag === "same")).toBe(true);
});

test("added lines are detected", () => {
  const hunks = computeDiff("line 1", "line 1\nline 2");
  /* One hunk of same, one of added. */
  const tags = hunks.flatMap((h) => h.lines.map((l) => l.tag));
  expect(tags).toContain("added");
});

test("removed lines are detected", () => {
  const hunks = computeDiff("line 1\nline 2", "line 1");
  const tags = hunks.flatMap((h) => h.lines.map((l) => l.tag));
  expect(tags).toContain("removed");
});

test("modified line shows as remove+add", () => {
  const hunks = computeDiff("old line", "new line");
  const tags = hunks.flatMap((h) => h.lines.map((l) => l.tag));
  expect(tags).toContain("removed");
  expect(tags).toContain("added");
});

test("line numbers are correct", () => {
  const hunks = computeDiff("a\nb\nc", "a\nx\nc");
  const all = hunks.flatMap((h) => h.lines);
  const sameA = all.find((l) => l.text === "a" && l.tag === "same");
  expect(sameA!.lineA).toBe(1);
  expect(sameA!.lineB).toBe(1);

  const added = all.find((l) => l.text === "x" && l.tag === "added");
  expect(added!.lineA).toBeNull();
  expect(added!.lineB).toBe(2);

  const removed = all.find((l) => l.text === "b" && l.tag === "removed");
  expect(removed!.lineA).toBe(2);
  expect(removed!.lineB).toBeNull();
});
