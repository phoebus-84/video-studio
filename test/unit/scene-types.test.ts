import { expect, test } from "vitest";
import { ROLE_LABELS, TRANSITION_LABELS } from "$lib/scene-types";

test("every scene role has a label", () => {
  const roles = Object.keys(ROLE_LABELS);
  expect(roles.length).toBeGreaterThanOrEqual(5);
  for (const val of Object.values(ROLE_LABELS)) {
    expect(val.length).toBeGreaterThan(0);
  }
});

test("every transition type has a label", () => {
  const transitions = Object.keys(TRANSITION_LABELS);
  expect(transitions.length).toBe(4);
});
