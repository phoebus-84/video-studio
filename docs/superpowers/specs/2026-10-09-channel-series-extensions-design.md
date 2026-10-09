# A channel's and a series' procedures live with them, not in the application

**Issue:** `avg-d1x`.
**Asked by the user, 2026-10-09:** "The application must have generic code and capabilities, must render, maybe offer templates, but everything about a series or a channel must sit at the channel's and the series' level. The application must know nothing about dentro-i-versi. It must only have the tools to make them; all the information and the procedures must sit at those levels."
**Design agreed in chat (2026-10-09).**
**Date:** 2026-10-09

## Problem

The application knows a lot about dentro-i-versi:
- **Series compilers.** The four dentro-i-versi compilers (`studio/series/src/compilers/dentro-i-versi-{short,long}/{1.0.0,1.1.0}.ts`) are each the series' "director". They hold:
  - the hall's geometry;
  - the actor's place;
  - the poses vocabulary;
  - the palettes;
  - the "DENTRO I VERSI" mark's width;
  - the timing of title, recital, bow and applause;
  - the section names;
  - the format's rules.
- **Validators.** The two dentro-i-versi validators are code in the app.
- **Kits.** Eight composer files are dentro-i-versi's: `museum-hall`, `interprete`, `verse-plate`, `title-chip`, `lower-third@1.0.0`, `brand-mark@1.0.0`, `lib/hall-fx`, `lib/dentro-i-versi`.
- **Tests and fixtures.** Thirty-odd test and fixture files use dentro-i-versi as their example.

Making a new series therefore means writing application code. Pi can't do it, and every channel adds to the core.

The data already sits at its level: the theme in the channel, the template in the series, and assets, takes and spec in the episode. The procedures don't.

## The model

Concentric levels. Each holds its own data **and its own procedures**. The application only executes.

| Level | Holds |
|---|---|
| **Application** | The runtime and pipelines, the `pva_*` tools, the render engine, the **generic kits** (`still`, `clip`, `captions`, `panel`, `cards`, `text-stack`, …), a **toolbox** for writing compilers, validators and kits, the **loader** that runs a channel's and a series' code, and **starter templates** a series copies (e.g. `poetry-short`). It contains no channel's name. |
| **Channel** `library/<channel>/` | Theme releases, characters, voices, skills, docs, and **channel kits**: drawing shared by the channel's series (e.g. the `interprete` actor, the brand mark). |
| **Series** `library/<channel>/series/<series>/` | Template releases (schema, FORMAT, sheet rules) that now also hold the **compiler** and **validator**. Also **series kits** (e.g. `museum-hall`, `verse-plate`), skills and `pipeline.yaml`. |
| **Episode** | Spec, pictures, takes, sounds, timings, renders. |

## Decisions

1. **A release carries its procedures as sealed code.**
   - **Compiler and validator.** A series template release gets `compiler/` and `validator/` folders. Each holds:
     - the TypeScript source, `index.ts` plus the files it imports;
     - its built bundle, `compiler.mjs` or `validator.mjs`.
   - **Kit release.** A kit release is `kits/<name>/<version>/` at the channel or series level. It holds:
     - `kit.tsx` (and its files);
     - its built bundle, `kit.mjs`;
     - `examples.json`;
     - `samples/`.
   - **Sealing.** Like a theme release (ADR-0040), every file of a release is listed with its sha256, and the loader refuses a file that changed. A release never changes; a change is a new version.
   - **Pinning.** `series-template.json` pins:
     - `compiler: {path, hash}` and `validator: {path, hash}`, instead of `{id, version}` in the app's registry;
     - the kits its compiler may draw with, each as `{name, version, level: "channel" | "series", hash}`.
2. **Bundles are built once, when the release is sealed.**
   - **Compiler or validator:** built with esbuild for Node as a self-contained ES module. The toolbox and the contracts' helpers it imports are inlined. A frozen release therefore keeps the toolbox version it was built with, and later changes to the toolbox don't alter old releases.
   - **Kit:** built as an ES module with `react`, `react/jsx-runtime`, `remotion` and `zod` left external, so it shares the app's single React and Remotion. The kit toolbox (fonts, text measuring) is inlined.
   - Nothing is rebuilt at render time: the sealed bundle is what runs.
3. **The commands.**
   - `vpr template seal <channel>/<series> <id> <version>`:
     - builds the compiler and validator;
     - checks that the kits the release pins are sealed;
     - writes the hashes.
   - `vpr kit seal <channel>[/<series>] <name> <version>`: builds the kit and writes its hashes.
   - Both refuse an already sealed release.
   - `vpr template release --from` (existing) copies a release as a new unsealed version, ready to change and seal. `vpr kit release --from` does the same for a kit.
4. **The loader.**
   - **Compiling** (`@studio/episode` load, then `@studio/series` compile and check):
     - the loader imports the release's `compiler.mjs` and `validator.mjs` by file URL, after verifying their hashes;
     - the module's default export implements the same `SeriesCompiler` and validator interfaces as today;
     - the app's registry stops naming series compilers.
   - **Rendering** (the composer's Remotion bundle):
     - the render is handed the kit releases the timeline's release pins;
     - the bundle's entry is generated to import the app's kits plus those `kit.mjs` files;
     - the bare externals resolve from the app's `node_modules` (a webpack `resolve.modules` override).
   - **Kit lookup:** a timeline's `name@version` resolves in the series' kits, then the channel's, then the app's. The same `name@version` at two levels is an error, never a shadow.
   - **Hashes:** `drawingCodeHash` and the render cache include the pinned kits' hashes, so the layout sheet and the cache follow a kit change as they follow an app kit change.
5. **The toolbox** is a package of the application: `@studio/series-kit` for compilers and validators, and the composer's kit types and libs for kits.
   - **What goes in:** what today's compilers and kits share or re-implement. That means:
     - resolving time cues (`verse:N±s`, `word:x`, `end`, `{word, n, offset}`) against measured words;
     - laying overlapping items on lanes;
     - mouth and energy from a take, blinks;
     - building a valid timeline (assets, hashes, profile, sections, `derivedFrom`, metadata);
     - the validator's findings;
     - fonts and text measuring for kits.
   - **How it grows:** by extraction, not by design ahead of need. It starts with what the dentro-i-versi compilers duplicate.
6. **Tests travel with their code.**
   - **Compiler and validator:** a template release holds `fixtures/`, with `input.json` and `expected-timeline.json`, plus the validator's cases. `vpr template verify` compiles the fixtures with the sealed bundle and compares byte for byte, which is today's golden test.
   - **Kits:** a kit release's examples are rendered by `vpr kit verify`, which is today's one-frame test.
   - **The application's own tests** use a neutral example channel, kept in the repository's fixtures. It has a tiny series with a compiler, a validator and one kit, and it exercises the loader, sealing, lookup, bundling and refusal paths.
7. **dentro-i-versi moves out without changing a frame.**
   - **New releases:** the four compilers, two validators and eight kit files go to the library as new releases:
     - kits at the channel level (`interprete`, `brand-mark`, `lower-third`, `title-chip`, hall effects) and the series level (`museum-hall`, `verse-plate`), decided by what both series draw;
     - templates `dentro-i-versi-short@1.4.0` and `dentro-i-versi-long@1.3.0`, built from today's code.
   - **Proof:** their golden fixtures compile to the same timelines as the app's versions, apart from `derivedFrom`, `metadata.builtBy` and the template pin. The kits' examples render the same frames.
   - **Episodes:** they move with `pva_upgrade_spec`. A timeline compiled by the new release draws the same frames, so the approved sheet's drawing stays the same, though its inputs change and it must be made again.
   - **Then the app's dentro-i-versi code, fixtures and tests are deleted.**
   - **Acceptance:** `git grep -il dentro -- studio packages ':!*.md'` finds nothing.
   - **Old releases:** short 1.0.0–1.3.0 and long 1.0.0–1.2.0 stay on disk but can no longer compile, because they name compilers the app no longer has. The renders already made stay.

## Phases

0. **Spike: a kit from outside the package in the Remotion bundle.** A throwaway kit file in a temp folder is built with esbuild, with the externals above. A generated entry imports it, and `renderStill` draws it, using the app's React. This is the design's main risk; if it fails, decision 2 changes before anything else is built.
1. **Compiler and validator from a release.**
   - Seal, build, load and verify, with the neutral example series.
   - The app's registry still holds dentro-i-versi, untouched.
2. **Kits from the channel and the series.**
   - Seal, build, lookup order, generated bundle entry, hashes in `drawingCodeHash` and the cache, `vpr kit verify`.
3. **The toolbox**, extracted from what the dentro-i-versi compilers share. This can overlap with phase 4.
4. **dentro-i-versi moves out** (decision 7), then the app's copy is deleted.
5. **Channels as repositories, and the `author-series` skill.** `vpr channel init` (git), dentro-i-versi made a repository, and the skill, written from what phases 1–4 established and tried on a new small series.

Each phase is its own plan and PR.

## Settled with the operator (2026-10-09)

- **Each channel is its own git repository.** `library/<channel>/` gets its own history and remote. Its code, releases and data are versioned there, and the application's repository never holds them. Sealed releases still guard a render; git guards the work. `vpr channel init` makes a new channel a repository. An existing channel becomes one once, by hand or with the same command; media too large for git are named in the channel's `.gitignore` (e.g. `**/output/`, `.cache/`), decided per channel.
- **Pi writes a series' procedures, guided by a skill.** A built-in skill, `author-series`, teaches Pi what a series needs and how to write it. It covers:
  - the levels, and where each thing goes;
  - the template;
  - the compiler, its time cues and the toolbox;
  - the validator;
  - kits;
  - fixtures;
  - sealing and verifying;
  - which tools to call.

  Pi can make very different products, and most don't use Remotion or a compiler: Blender scenes, narrated illustrated videos, repository documentation. So the skill opens by telling Pi which kind of product it is making:
  - **A spec-driven series rendered with kits:** the procedure above, in full.
  - **Another pipeline family:** the skill says so and points to that family's skills. The principle stays: what is specific goes to the channel or the series, never into the application.

  Pi's code is reviewed like everything else: through the golden fixtures, `vpr template verify`, `vpr kit verify` and the layout sheet the operator approves.

## Out of scope

- **Concentric context.** Pi loading general, then channel, then series, then episode docs and skills on its own (and scanning channel skills) is a follow-up issue, made easier by this one.
- **A declarative, code-free compiler.** dentro-i-versi's poses from words, mouth from energy and lightning at picture changes need code. A declarative layer can come later on top of the toolbox.
- **Sandboxing library code.** The application runs the library's sealed code in its own process, as it runs its own. It is a local, single-user system; isolation is avg-qr4.8's.
