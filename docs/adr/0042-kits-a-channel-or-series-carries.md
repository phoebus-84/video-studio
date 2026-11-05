# ADR-0042: Kits a channel or a series carries

## Status

Accepted (`avg-d1x`, phase 2). Implemented:
- the `KitRelease` contract (`kit.json`) and `kits` pins in `SeriesTemplate`;
- the composer drawing library kits beside its own;
- the loader;
- `vpr kit seal` and `vpr kit verify`.

## Context

ADR-0041 put a series' compiler and validator in its release. What they draw with was still the composer's code: the first channel's hall, interpreter, verse plates and titles are kits in `packages/remotion-composer`. A phase 0 spike showed that a kit built outside the package, with React, Remotion and zod left external, can be bundled by Remotion and drawn with the application's own React.

## Decision

**A channel or a series may carry kits in the library.**
- **The kit release.** A kit release is `library/<channel>/kits/<name>/<version>/`, or the series' own `kits/`. It holds `kit/index.tsx`, exporting `kit` (a `KitVersion`: name, version, description, zod `props`, `component`, examples).
- **Sealing.** `vpr kit seal` builds it into one CommonJS file, `kit.cjs`:
  - React, Remotion and zod are left to the application, so the kit draws with the same React and Remotion as everything else;
  - modules are named by place, never by machine path, as in ADR-0041.

  It checks that the bundle exports the kit its folder names and takes no application kit's `name@version`. Then it writes `kit.json` with the bundle's hash.
- **Pinning.** A series release lists the kits it may draw with: `kits: [{name, version, level: "channel" | "series", hash}]`, where `hash` is `kit.json`'s, filled in by `vpr template seal`. A pinned kit is never resealed.
- **The loader.**
  - It reads the kits the release pins, inside the channel or the series, and records both files among the timeline's inputs.
  - It refuses a `kit.json` or `kit.cjs` that is not the pinned or sealed one (`kit-mismatch`), and a kit that takes an application kit's name (`kit-shadows`).
  - It loads each kit in Node, resolving its external packages from the composer.
- **Compiling.** Kit props are validated as an application kit's.
- **Rendering and the layout sheet.**
  - They receive the kits as files plus hashes.
  - The composer reads each kit's bytes, checks their hash and loads them.
  - It writes those exact bytes, with a generated Remotion entry, into a folder named by the kits' hashes. The entry registers the library kits, then the root renders. Webpack bundles the bytes that were checked, and the bundle is the same render after render. Webpack names modules by path, so a random folder would defeat the render cache, which hashes the whole bundle.
  - The externals resolve from the application first, so a `node_modules` beside a kit never brings a second React.
  - The sheet's kit lock holds a library kit's bundle hash, so a kit change makes the sheet stale.
  - A `name@version` is pinned and handed once, never twice.
- **`vpr kit verify`** checks the bundle is the sealed one, warns when the source no longer builds to it, and holds each example's props to the kit's schema.

## Consequences

- **Moving out.** A format's look and drawing can live with the channel, versioned in its repository. Phase 4 moves the first channel's kits out.
- **Lookup.** A timeline names a kit `name@version`. The application's kit wins, and a library kit can't take its name. The release's pins list exactly which library kits exist for it.
- **Sharing.** Library kits share the application's React, Remotion and zod. A kit that needs another package bundles it.
- **No kit toolbox yet.** The composer's fonts and text measuring aren't importable by a library kit yet: the package exports only its index, and the fonts are `.woff2` files. Phase 3 (the toolbox) and phase 4 (the first channel's kits moving out) supply them.
