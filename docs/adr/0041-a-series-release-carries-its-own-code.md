# ADR-0041: A series release carries its own code

## Status

Accepted (`avg-d1x`, phase 1). Implemented:
- `compiler.bundle` and `validator.bundle` in `SeriesTemplate`;
- the loader that runs a release's sealed bundles;
- `vpr template seal` and `vpr template verify`.

Kits (phase 2), the toolbox (phase 3) and moving dentro-i-versi out of the application (phase 4) follow. See `docs/superpowers/specs/2026-10-09-channel-series-extensions-design.md`.

## Context

ADR-0037 pinned a series template release to a compiler and a validator by `id@version` in the application's registry. That makes every series format application code: dentro-i-versi's director lives in `studio/series`, and a new series means a change to the core.

The operator's rule (2026-10-09): the application holds generic code and capabilities. Everything about a channel or a series, data and procedures, sits at the channel's and the series' level. Each channel is its own git repository.

## Decision

**A series template release may carry its compiler and validator as code.**
- **Source.** The source is `compiler/index.ts` and `validator/index.ts` in the release, exporting `compiler` (a `SeriesCompiler`) and `validator` (a `SeriesValidator`).
- **Sealing.** `vpr template seal` builds each with esbuild into one self-contained CommonJS file:
  - the packages it imports (the contracts' helpers, later the toolbox) are inlined, so a later change to them never alters the release;
  - Node's built-ins stay external;
  - every module is named by its place in the release (`release:compiler/x.ts`) or in its package (`app:@studio/contracts@0.1.0/src/cues.mjs`), never by a path on the machine, so the bundle is the same wherever the library and the application sit;
  - no `tsconfig.json` above the release changes it.

  The bundle must export the role under the `id@version` the manifest names; sealing refuses one that doesn't.
- **The manifest.** It names the bundle and its sha256: `compiler: {id, version, bundle: {path, hash}}`. A release without `bundle` keeps the registered compiler or validator, so ADR-0037 releases are unchanged.
- **Loading.** The loader reads the bundle like every other file of the release:
  - inside the series, its hash recorded among the timeline's inputs;
  - refused when its hash isn't the sealed one (`code-mismatch`), missing (`missing-code`), or not exporting the role (`bad-code`).

  It runs the bytes it checked, one module per hash. The compiler and validator must say the `id@version` the manifest names.
- **Pinned releases.** A release that an episode or a golden reference pins is never resealed (`release-pinned`). A spec or reference that can't be read counts as a pin. A change is a new release: `template release --from`, change the source, seal. `template release --compiler/--validator` refuses to rename code the release carries (`bundled-code`): the code says its own version.
- **Tests travel with the code.** `vpr template verify`:
  - checks the bundles;
  - rebuilds the source and compares, as a warning only (`rebuild-differs`): the source, or the studio code it inlines, may have moved on since sealing, and the sealed bundle is what runs;
  - compiles `fixtures/<name>/input.json` as this release and compares with `expected-timeline.json` byte for byte;
  - holds the result to the release's validator.

## Consequences

- **A series format is library data plus library code.** The application runs it without knowing it, and it is versioned in its channel's repository.
- **The application runs code from the library**, in its own process. It is a local, single-user system; isolation from the user's own code is avg-qr4.8's OS question, not this one's.
- **The registry stays.** It holds the starter compilers and what phase 4 has not moved yet.
