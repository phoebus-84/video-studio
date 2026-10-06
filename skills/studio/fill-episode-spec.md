---
name: fill-episode-spec
version: "0.1.0"
description: Create a series episode's spec from its template release and fill every placeholder, keeping the series' fixed standards
inputs:
  - name: release
    type: text/markdown
    description: The template release's FORMAT.md (the standard and the procedure), its episode-spec.schema.json and its episode-spec.template.json
  - name: content
    type: string
    description: What this episode is about — the person's brief, the poem, the source material
outputs:
  - episode-spec.json:
      kind: application/json
      description: The episode's spec, pinned to one exact template release, with no __FILL__ left
capabilities:
  - llm
---

# Fill Episode Spec

A series episode starts from its spec (`episode-spec.json`): the content of
this episode, in the shape its series' template release fixes (ADR-0037). The
release decides the format — style, voice, profile, compiler, rules; the spec
supplies only the content. This is the `spec` stage of the
`series-production` pipeline; a person approves the result at its gate.

## Steps

1. **Create the draft** with `pva_init_spec { channel, series, episode,
   template, version }`. Ask for the exact release (`x.y.z`) if the person
   has not named one — never pick "the latest". It refuses to replace an
   existing spec: if there is one, edit it instead.
2. **Read the release**: `templates/<id>/<version>/FORMAT.md` is the
   standard and the procedure; `episode-spec.schema.json` says the type and
   the limits of every field. Read both before writing anything.
3. **Fill every placeholder** the tool listed (`$.data["title"]`, …) with a
   value of the type the schema asks: a number where it says number, an
   array of objects where it says array. `__FILL__` can stand for any value,
   not only text.
4. **Check** with `pva_check_episode`: `unfilled` and schema problems are
   reported first, with their JSON paths; then the series' rules. Repeat
   until nothing but warnings remains.
5. **Hand it over** at the stage's review gate: say what you filled and why,
   and quote every warning.

## Never

- Never change a value the schema fixes (`const`: the style, the caption
  kit, the voice profile, the output profile) — a different format is a new
  template release, which only a person decides.
- Never edit, copy or "correct" the release: it is immutable, and its hashes
  make every episode pinned to it fail.
- Never invent content the person did not give or approve: a missing fact
  is a question, not a placeholder filled with a guess.
- After the spec is approved, raise `revision` by one for every edit.
