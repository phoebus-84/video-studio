# Cue grammar and resolver

**Issue:** `avg-7zp.2` — cue grammar and deterministic resolver
**Epic:** `avg-7zp` — contracts for word-anchored, layered production (the `cs-port` plan)
**Depends on:** [word timing](2026-10-05-word-timing-design.md) (`avg-7zp.1`, merged)
**Blocks:** `avg-jao.2` (series compiler: spec + timing → edit timeline)
**Date:** 2026-10-05

## Problem

A series spec says *when* things happen in terms of the voice: a lightning
bolt on "lampo", a picture changing at the end of verse 3, applause four
seconds after the poem. The [edit timeline](2026-10-05-edit-timeline-v2-design.md)
only knows integer frames. Something must turn the first into the second,
deterministically, and refuse when it cannot.

CreativeStudio has two grammars for this: the long format's `"word"`,
`[word, n]`, `{w, n, dt, end}` or seconds, and Poesie 2's strings
`verse:3+0.5`, `verseEnd:9`, `word:alleata`, `end+4.3`, `picture:2+0.3`. Its
matching is accent- and case-insensitive, handles elisions, and is by
**prefix**. Its runtime falls back silently: a missing word yields a default
time, a verse number out of range is clamped.

## Decisions taken with the user

1. **Whole-word matching; prefix only when asked**, with a trailing `*`
   (`"terr*"`). Prefix by default fires on the wrong word without warning
   (`"ama"` → "amava", `"lampo"` → "lampone"). Old episodes are not migrated,
   so the cleaner rule costs nothing.
2. **Short forms for the common cases, objects for the rest.** A word is a
   string, seconds are a number; everything else is an object the schema can
   check field by field. No string mini-language.

## Design

### Grammar

```jsonc
"lampo"                                    // word, first occurrence, at its start
"terr*"                                    // word by prefix
4.5                                        // seconds from the start of the take (>= 0)
{ "word": "lampo", "n": 2, "at": "end", "offset": -0.3 }
{ "line": 3, "at": "end", "offset": 0.5 }  // line (verse) 3, counted from 1
{ "take": "end", "offset": 4.3 }           // "start" = 0; "end" = end of the last spoken word
{ "mark": "picture:2", "offset": 0.3 }     // a named mark supplied by the series compiler
```

- `at`: `"start"` (default) or `"end"` — of the word or line.
- `offset`: seconds, may be negative, default 0. Allowed on `word`, `line`,
  `take`, `mark` objects.
- `n`: integer ≥ 1, default 1, only on `word`.
- A word string (short or in `word`) is non-empty; `*` may only appear once,
  at the end, after at least one other character.
- Objects are closed (`additionalProperties: false`); exactly one of `word`,
  `line`, `take`, `mark` per object.

### Matching a word

Both the cue's word and every spoken word (`WordTiming.words[].text`, the
written token) are **normalised** the same way: Unicode NFD, combining marks
removed, lower-cased, everything but `a–z` and `0–9` removed. A spoken word
matches when its normalised **whole token**, or the normalised part after its
last apostrophe (`'` or `’`), **equals** the cue's normalised word. With a
trailing `*`, "equals" becomes "starts with". So `"italia"` and `"l'italia"`
both find "L'Italia,"; `"versi"` finds "versi,"; `"perche"` finds "perché";
`"terr"` finds nothing where `"terr*"` finds "terra,". Matching uses the
written text, never `spoken`: `"myricae"` finds "Myricae." whose `spoken` is
"Mirìce.".

`n` counts matching words in take order.

### From a cue to a frame

A cue is resolved in a **scope**: one take placed in the episode.

```js
{ timing /* a valid WordTiming */, startSeconds /* where the take starts in the episode, >= 0 */,
  fps /* integer > 0 */, marks /* optional: { name: seconds in the take } */ }
```

1. Time in the take: the word's or line's `start`/`end` (`at`); `0` or the end
   of the last word (`take`); the mark's value (`mark`); the number itself.
2. Plus `offset`.
3. Plus `startSeconds`.
4. `frame = Math.round(seconds × fps)`.

A result after the end of the take is allowed (`take: end` + 4 s of
applause). A result before the start of the episode (negative seconds) is an
error.

### Errors — never a fallback

| Code | When |
|---|---|
| `invalid-cue` | The cue does not match the `Cue` schema |
| `unknown-word` | No matching word, or fewer than `n` (the message says how many there are) |
| `unknown-line` | `line` is beyond `timing.lines`, or the take has no lines |
| `unknown-mark` | `mark` is not a key of `scope.marks` |
| `before-start` | The resolved time is before the start of the episode |

### API — `studio/contracts/src/cues.mjs`

- `resolveCue(cue, scope)` → `{ frame, seconds }` or `{ problem: { code, message } }`.
- `resolveCues(entries)` with `entries = [{ path, cue, scope }]` →
  `{ frames: { [path]: frame }, problems: [{ code, message, path }] }`. Every
  entry is resolved; every failure is reported with its path. This is what the
  series compiler calls after walking its own spec.
- `normalizeWord(text)` is exported so other modules (verse bars, captions)
  match the same way.
- `scope.timing` is assumed to have passed `validateWordTiming`; the resolver
  does not validate it again. `scope.fps` must be a positive integer and
  `scope.startSeconds` a number ≥ 0, otherwise `resolveCue` throws
  `TypeError` (a compiler bug, not a data problem).

### Schema — `schemas/v1alpha1/cue.schema.json`

`$id` `https://video.studio/schemas/v1alpha1/cue.schema.json`, `$defs`:
`WordPattern`, `Offset`, `At`, `WordCue`, `LineCue`, `TakeCue`, `MarkCue`,
`Cue` (the union: `WordPattern` string, number ≥ 0, or one of the four
objects). Series spec schemas `$ref` `Cue`, so a typo such as `"ofset"` fails
when the spec is validated, before compilation. `resolveCue` validates against
the same definition (`invalid-cue`). Bindings: `bindings/ts/cue.ts`.
`@studio/contracts` goes from 0.3.0 to 0.4.0.

## Testing

On the real word-timing fixtures already in the repository:

- Il lampo "epoca" take: `"versi"` → "versi," (word 4); `"italia"` and
  `"l'italia"` → "L'Italia" (word 21); `"myricae"` → "Myricae." (word 20);
  `{ word: "di", n: 3 }` → word 27; `n: 99` → `unknown-word` saying there are
  10; `"terr*"` → "terra," (word 76) while `"terr"` → `unknown-word`;
  `at: "end"`, a negative `offset`, `take: "end"` (end of "Ruggero.", 47.422).
- San Martino recital: `{ line: 3, at: "end" }` → 14.09 ("tini");
  `line: 9` → `unknown-line`; `line` on the epoca take (no lines) →
  `unknown-line`.
- `mark` known and unknown; a number; rounding at 30 and 24 fps with a
  non-zero `startSeconds`; `before-start` with a large negative offset.
- `invalid-cue`: a misspelt field, two kinds in one object, `n: 0`, `"*"`,
  `"te*rr"`, a negative number.
- `resolveCues`: frames and problems together, with paths.
- `TypeError` for a non-integer fps or a negative `startSeconds`.
- Schema fixtures (valid and invalid `Cue` values) in `check:schemas`;
  bindings up to date; `npm run check` in `studio/contracts` and at the root.

## Out of scope

- Walking a series spec to find its cues, and choosing each cue's take and
  marks: the series compiler (`avg-jao.2`).
- Snapping to word boundaries, easing, or any timing beyond "this instant".
