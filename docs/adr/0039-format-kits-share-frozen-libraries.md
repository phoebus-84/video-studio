# ADR-0039: Format kits share frozen libraries

## Status

Accepted (`avg-dcf.3`). The kits of the Dentro i versi short —
`museum-hall`, `room-effect`, `verse-plate`, `interprete`, `lower-third`,
`title-chip`, `brand-mark`, all `1.0.0` — are the first to import library
modules, and `remotion-composer`'s lock covers them.

## Context

A kit version never changes (ADR-0034): a delivered episode must re-render
as it was. So far a kit file could import only `react`, `remotion`, `zod`
and types, which kept it self-contained and its lock entry — the file's
sha256 — honest. CreativeStudio's museum format is seven pieces drawn with
the same math (smoothstep ramps, envelopes, deterministic noise), the same
palette and fonts, the same picture and room effects and the same actor.
Copying all of it into each of seven files would freeze seven diverging
copies; importing ordinary shared code would let a later edit change every
released kit that uses it, silently.

## Decision

**Kits may import frozen library modules**: `src/kits/lib/<name>/<version>.ts`
(or `.tsx`), imported by exact version — `../lib/stage-math/1.0.0.js`. A
library module follows the kit rule: it imports only `react`, `remotion`,
`zod`, types, and other library modules by exact version; the one exception
is a font file, which a library module may import dynamically (`import()`
of an `@fontsource/*` `.woff2`), so the browser loads it and Node never
does.

**The lock covers what a kit draws with.** A kit's hash in `kits.lock.json`
is the sha256 over its file and every library module it reaches, each as
its path relative to `src/kits` and its bytes, in sorted order. A kit that
imports no library module hashes exactly as before — its file's sha256 —
so every existing entry stays valid. Editing a released library module
therefore fails the lock of every kit that reaches it; the fix is a new
module version next to the old one, imported by a new kit version.

A kit may declare `profiles`: the output profiles it is drawn for. A
timeline that uses it in another profile is refused (`wrong-profile`)
before its props are checked; previews and one-frame tests cover only
those profiles. The museum kits are drawn for `vertical-1080x1920`.

Fonts are pinned packages, never system fonts: `@fontsource/anton`,
`@fontsource/fraunces` and `@fontsource/inter` 5.3.0 (OFL), loaded inside
the browser through `FontFace` with Remotion's `delayRender`, so no frame
is drawn before its fonts.

## Consequences

- Shared drawing code is written once per version and frozen like a kit;
  seven kits share one actor, one set of effects, one palette.
- The lock check reads imports: a library import that is not
  `<name>/<version>.js`, or a module that imports beyond the rule, fails
  `npm test`.
- Channel specifics now live in composer code (`lib/dentro-i-versi` — the
  palette —, the actor's costumes and poses, the series compiler). That is
  against the boundary the studio is moving to (`avg-d1x`): looks and
  parameters as library data, the application executing, composers and
  channel-neutral kits as plugins. Accepted for this format; `avg-d1x`
  restores the boundary.
