# One repository, split into reusable packages and the product

## Status

Accepted. Supersedes ADR-0022 (modules have independent Git and Beads history).

## Context

ADR-0022 gave each of the eleven modules its own Git repository, so they could
evolve independently. In practice the independence was never real and the cost
was paid in full.

Measured before this change:

- **The workspace did not install.** Modules were linked with `file:../`
  dependencies, which materialize as symlinks holding absolute paths. The tree
  was authored under one developer's home directory, so every link dangled
  elsewhere. 20 of 28 `video-pipeline-runtime` test files failed at import; only
  103 of 339 tests were being discovered at all.
- **The modules were coupled by relative path anyway.** The pipeline linter read
  `../../video-workspace-contracts/schemas/...`; the gateway guessed three
  hardcoded sibling paths to the runtime's `src/cli.ts` and fell back to a bare
  `vpr` on `PATH`; the gateway's executor imported the composer through
  `../../../ffmpeg-video-composer/src/qa.ts`. None of these survive a clone of a
  single repository, so the modules were never independently usable.
- **No atomic cross-cutting change was possible.** A change to the contracts and
  its consumers spanned repositories with no way to land or revert together.
- **CI existed in one module of eleven.** The broken install, 25 failing adapter
  tests, and a stale schema that rejected all three real pipeline manifests all
  survived unnoticed.
- **Package management had split-brain.** Despite ADR-0031 mandating bun, four
  modules carried only `package-lock.json`, four only `bun.lock`, and two both.

The genuine insight inside ADR-0022 was that *some* of these modules are useful
outside this project. A speech synthesis worker, a deterministic graphics
renderer and an FFmpeg timeline compiler are tools; the fact that this studio
uses them to make episodes is the studio's business, not theirs. That insight
does not require eleven repositories — it requires a boundary.

## Decision

One repository, split into two tiers:

```
packages/   reusable outside this project. Zero knowledge of episodes,
            pipelines, contracts, or the studio.
studio/     the product. Depends on packages/. All studio-specific
            integration lives here.
skills/     shared/ for any agent workflow; studio/ for production stages.
```

The boundary is a rule, not a convention: **`packages/*` may not depend on
`studio/*`**, enforced by `tools/check-boundaries.mjs`, which fails on a
declared `@studio/*` dependency, a `@studio/*` import, or any workspace reaching
into another by relative path.

Composition is explicit and happens at install time. `compose.config.json`
declares every component, the capabilities it provides and what it requires;
`tools/compose.mjs` resolves a profile into `composed.json`. A profile can take
one package and nothing else. Composition never substitutes one provider for
another and refuses to arbitrate when two components claim one capability.

Dependencies use `workspace:*`. `file:../` is prohibited and
`tools/check-no-foreign-paths.mjs` fails the build if an absolute path
reappears in a symlink or a tracked file.

## Consequences

- A clone installs with `bun install` on any machine. The runtime's 339 tests
  all run and pass, where 236 of them previously were never collected.
- The three cross-module path hacks became declared package dependencies. The
  gateway now fails loudly if the runtime is not installed, instead of silently
  falling back to whatever `vpr` means on the host.
- One lockfile, one CI workflow covering every module, one place to land a
  cross-cutting change.
- Publishing a package on its own remains possible and is now *provable*: if it
  could not stand alone, `check:boundaries` would already be failing.
- History is preserved. All eleven repositories were imported with
  `git subtree`, retaining 335 commits.
- The per-module Beads databases were carried over as-is. Consolidating them is
  follow-up work, not a precondition.
