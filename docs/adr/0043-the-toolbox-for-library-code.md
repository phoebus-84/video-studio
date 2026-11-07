# ADR-0043: The toolbox for a channel's and a series' code

## Status

Accepted (`avg-d1x`, phase 3). Implemented:
- `@studio/series/toolbox/1.0.0`;
- the composer's kit libraries exported as `@av/remotion-composer/kits/lib/<name>/<version>`, kept external in a library kit.

## Context

ADR-0041 and ADR-0042 let a series release carry its compiler and validator, and a channel or a series carry kits. Code written in the library needs the application's helpers, without copying them and without depending on what changes.
- **Compilers.** The three compilers each carry the same private helpers: frames, rounding, word normalization, tokens, the deterministic noise, lanes, `isObject`. The first channel's two compilers each find the n-th spoken word their own way.
- **Kits.** The composer's kits share frozen, versioned libraries under `kits/lib/<name>/<version>`: fonts, font metrics, stage maths, stage props, the look, the lesson stage, the interpreter. The fonts load `.woff2` files once for every kit.

## Decision

**The toolbox is versioned and frozen, like everything a release depends on.**
- **For compilers and validators: `@studio/series/toolbox/<version>`.**
  - Version 1.0.0 holds `frames`, `round3`, `tokens`, `normalizeWord` (with a locale), `noise`, `isObject`, `lanes`, `findWord`, `problem` and `kitsOf`.
  - `frames`, `round3`, `tokens`, `normalizeWord`, `noise`, `isObject` and `lanes` behave exactly as the compilers' private copies; its tests hold them to those copies.
  - `findWord` (the n-th time a take says a word) is a superset of the two lookups of the first channel's compilers, not a copy of either:
    - it matches the parts around an apostrophe, as the long's cues do;
    - it falls back to a prefix when asked, as the short's `word:` does;
    - a word that normalizes to nothing finds nothing.

    A compiler moved onto it may resolve those edge cases differently, so moving one is a new compiler version with its own golden fixture.
  - A compiler imports it by version, and `vpr template seal` inlines it, so a release keeps the exact behaviour it was sealed with.
  - The released compilers stay as they are: they are frozen. The toolbox is for new code.
- **For kits: the composer's own libraries, by version.**
  - `@av/remotion-composer/kits/lib/<name>/<version>` is exported.
  - `vpr kit seal` leaves `@av/remotion-composer/kits/lib/…` external, like React, Remotion and zod. A library kit therefore shares the application's single copy: the fonts load once, and a frame waits for them as in every kit.
  - Any other import from the composer is refused at seal: its index is the renderer, never drawing code.
  - Node loads those libraries, which are ES modules, from the kit's CommonJS bundle, so the composer needs Node ≥ 20.19 (its `engines`).
  - The libraries are frozen by version, so a sealed kit that names one keeps drawing as it did. A change to them is a new version, and `drawingCodeHash` already covers them.
- **The toolbox grows by extraction**, as a new version, when two series need the same thing. It is never designed ahead.

## Consequences

- **Phase 4 can move the first channel's kits out.** They import these libraries. The ones that are the channel's own (`lib/<channel>`, `lib/hall-fx`) move with them.
- **The skill points here.** The `author-series` skill (phase 5) points Pi to the toolbox and the kit libraries as what to import, and what never to copy.
