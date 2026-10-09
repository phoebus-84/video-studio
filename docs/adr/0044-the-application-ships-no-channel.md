# ADR-0044: The application ships no channel's format

## Status

Accepted (`avg-d1x`, phase 4). Implemented:
- the first channel's compilers, validators and the kits only its short series drew with have left the application;
- they are sealed releases in that channel's library.

## Context

ADR-0041 to ADR-0043 let a series release carry its own compiler and validator, let a channel or a series carry kits, and gave that code a toolbox. The application still held one channel's format:
- two compilers at two versions each, and two validators;
- seven kits its short series drew with: the museum hall, the interpreter puppet's first version, the verse plates, the title chip, the room effects, the lower third and the brand mark's first version;
- the two libraries only those kits used;
- the fixtures and tests of all that.

The operator's rule (2026-10-09): the application must know nothing of a channel.

## Decision

**A channel's format lives in its library, and the application registers only its starter compilers and its generic kits.**
- **The kits.** The seven kits are the series' own kits, sealed in `library/<channel>/series/<series>/kits/<name>/1.0.0/`. They are the same code, with their imports pointed at the composer's kit libraries by version (ADR-0043) and at the two channel libraries, copied beside each kit. Their lock entries left `kits.lock.json`; the composer's lock test names them as moved out, the only versions allowed to leave it.
- **The compilers and validators.** They are the code of new template releases (ADR-0041): the short's next release, which also pins its seven kits, and the long's next release. Each holds its golden fixture.
- **Proof of the compilers.** `vpr template verify` compiled each release's golden fixture to the timeline the application's compiler wrote, every field the same but `metadata.template`, the release's name.
- **Proof of the kits.**
  - The two episodes on these formats moved onto the new releases.
  - Every layout-sheet still of both was rendered with the application's code before the move and with the library's code after it, and compared.
  - The two differ as much as two renders of the same code differ: the same worst still, the same largest pixel difference. Nothing else changed.
- **The tests.**
  - Tests of the format's own code left with it: its golden fixtures, checked by `template verify`, pin it now.
  - Tests that used the format as their example of a generic mechanism moved onto neutral fixtures: the contracts' sample theme and the starter poetry-short release. These cover themes, new looks, draft upgrades, pins and theme releases.
- **Acceptance.** No source file of the application names the channel. The CLI's help speaks of `my-channel/my-series`. Test data, contract fixtures and docs may still use the channel's name as an example.

## Consequences

- **Older releases no longer compile.** The format's earlier template releases name compilers and kits the application no longer has. The videos already rendered stay.
- **A channel's format changes in its own repository** (phase 5), as a new release, sealed and verified there.
- **Sealing with a relative library path works.** This phase found that `vpr kit seal --library library` failed, because esbuild needs an absolute working directory. It also found that `template verify` compiled fixtures without the release's pinned kits. Both are fixed.
