---
name: propose-reference
version: "0.1.0"
description: Propose an approved series episode as one of its series' golden references, for the operator to approve
inputs:
  - name: episode
    type: string
    description: The channel/series/episode the person says is exemplary of its series, with its current render approved
  - name: referenceId
    type: string
    description: A new lowercase kebab-case id for the reference, e.g. san-martino-v1
outputs:
  - reviews/references/<id>/:
      kind: directory
      description: The frozen spec, the frozen timeline and proposal.json — unsigned
capabilities:
  - llm
---

# Propose Reference

A golden reference is evidence of a series' standard (ADR-0037): an episode a
person approved as *the* example of the format, frozen — its spec, its
timeline, its render — and signed by the operator. Later episodes are compared
with it. You can only **propose** one; a person approves it.

## When

- The person says this episode is exemplary of its series, in so many words.
  Never propose an episode on your own judgement, and never because it was
  rendered without errors.
- Its current render is the one the person approved. If they asked for
  changes since, render again and let them approve it first.

## How

1. Check with `pva_check_episode`: no errors (a reference cannot break its
   own series' rules); mention every warning to the person.
2. `pva_propose_reference { channel, series, episode, referenceId }` with a
   new id (`<episode>-v1`, `-v2` for a later one). It refuses an id already
   used, an episode whose spec or timeline changed since the render, and one
   that breaks the series' rules — say why, and what to do.
3. Tell the person what was frozen, and the command only they can run:
   `vpr reference approve <channel>/<series>/<episode> <id>`
   (with `--dry-run` first if they want to see the descriptor).

## Never

- Never approve, sign, or run `vpr reference approve` or `withdraw` yourself:
  they need the operator key, and a reference is a person's decision.
- Never edit a snapshot in `reviews/references/`, a `proposal.json`, a
  promoted descriptor in `templates/<id>/references/`, or a withdrawal.
- Never replace a reference: a better episode is a new reference with a new
  id; the operator withdraws the old one if it no longer stands.
