// ── One transition table, in two places ─────────────────────────────────────
//
// `VALID_TRANSITIONS` is declared twice on the live path: once in
// @studio/contracts' execution-state replay, once in the engine's types. Both
// are consulted on every claim — the contracts table when the journal is
// replayed into stage state, the engine's inside `sm.transition` — and each
// carries a comment telling the reader to go check the other before changing
// it. A comment is not a test. Two copies of one meaning drift, and the drift
// here is not cosmetic: the two tables disagreeing on `completed -> pending`
// is a journal that replays on one path and throws REPLAY_INVALID on the
// other, for the life of the episode, because the journal is append-only.
//
// This does not argue for one table. It pins that there is one meaning.

import { describe, expect, it } from "vitest";
import { VALID_TRANSITIONS as ENGINE_TRANSITIONS } from "../../../src/engine/types.js";
import { VALID_TRANSITIONS as REPLAY_TRANSITIONS } from "@studio/contracts/src/execution-state.mjs";

describe("the stage transition table", () => {
  it("says the same thing in the engine and in replay", () => {
    // Structural equality, not key-by-key: a member added to one table and
    // not the other is exactly the failure this exists to catch.
    expect({ ...ENGINE_TRANSITIONS }).toEqual({ ...REPLAY_TRANSITIONS });
  });

  it("still allows a completed stage to be re-run", () => {
    // The one entry both comments warn about. Someone "restoring" the
    // single-run reading (`completed: []`) in either file makes every
    // re-run of a completed stage permanently underivable.
    expect(ENGINE_TRANSITIONS.completed).toEqual(["pending"]);
    expect(REPLAY_TRANSITIONS.completed).toEqual(["pending"]);
  });
});
