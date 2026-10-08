# A new look: sealed theme releases, template releases on them, specs moved forward

**Issues:**
- `avg-dcf.6.8`: a theme pin covers `theme.json` only;
- `avg-dcf.6.10`: changing a channel's look with the studio.

Both are under `avg-dcf.6`, Il lampo long end to end, and are done in one run.

**Builds on:**
- channel themes (ADR-0040);
- series templates (ADR-0037);
- `pva_init_spec` (`avg-jao.4`).

**Found by:** the long Il lampo's layout sheet (`avg-dcf.6.4`, 2026-10-08). The library theme `dentro-i-versi@1.0.0` still has placeholder rooms: the atrio and the hall are the same image, and the monitor plays an FFmpeg test pattern. Replacing them (`avg-dcf.6.7`) needs a new theme release, new template releases and the episodes moved onto them. The studio can do none of the three.

**Date:** 2026-10-08

## Problem

ADR-0040 says a published episode re-renders with the look it had, until a new release pins a new theme. Three things break that promise or block the change.

1. **The pin holds `theme.json` only.** The loader hashes `theme.json` against the template's pin. The room images and monitor clips it names are read but held to nothing, so replacing `rooms/atrio.png` in place silently changes every episode that pins the release.
2. **Releases are made by hand.** Making a theme release or a template release means:
   - copying folders;
   - computing sha256 hashes;
   - editing manifests.

   No command does it, so Pi cannot, and a person can get it subtly wrong.
3. **An episode cannot move to a newer release.** `pva_init_spec` never replaces a spec, and nothing else re-pins one. Moving the two Il lampo episodes means editing their spec's `template` pin by hand.

## Decisions

1. **A theme release lists its files.**
   - **Contract.** `theme.json` gains an optional `files` object: `{ "<path>": "sha256:<hex>" }`, one entry per file the theme names. Those files are each room's `image` and each monitor's `video`.
   - **`validateChannelTheme`.** When `files` is present, it must list exactly those paths:
     - a named file that isn't listed is `unlisted-file`;
     - a listed file the theme doesn't name is `unused-file`.

     The pure helper `themeFilePaths(theme)` returns the named paths.
2. **The loader holds a sealed theme to its files.**
   - Every file `files` lists is hashed. A different hash stops the load with `theme-mismatch` at that file, saying it isn't the file the release sealed.
   - A theme without `files` loads as before, so releases made before this change keep working. The load result carries a warning (`theme-unsealed …: its files can change under the release`), which the compile result, `pva_build_timeline` and `pva_check_episode` pass on.
3. **`sealTheme(channelDir, id, version)`**, in `@studio/runtime` (`theme-release.ts`). It writes `files` into the release's `theme.json` and returns the new `theme.json` hash: the hash a template release pins. It refuses (as `ThemeReleaseError`, with a code):
   - a release already sealed (`sealed`);
   - a release some template release in the channel already pins (`pinned`, naming the pinning releases, because sealing changes `theme.json`'s hash);
   - a missing or escaping file (`missing-file`, `path-escape`);
   - a theme that fails the contract (`bad-theme`).

   The CLI is `vpr theme seal <channel>/<theme>/<version> [--library <path>]`.
4. **`releaseTemplate(seriesDir, {id, from, version, theme?})`**, also in `@studio/runtime`'s `theme-release.ts`. It copies the release `from` to `version`, sets the manifest's `version`, and, given `theme: {id, version}`, pins that theme release by the hash of its `theme.json`. It writes nothing unless the new release is valid. It refuses:
   - a version that exists already (`release-exists`) or isn't greater than `from` (`bad-version`);
   - a theme that is missing or unsealed (`theme-unsealed`);
   - a bundle that fails `validateTemplateBundle`.

   The copied files keep their hashes, so the manifest's `files` stay valid. The CLI is `vpr template release <channel>/<series> <template-id> <version> --from <version> [--theme <id>@<version>] [--library <path>]`.
5. **`upgradeEpisodeSpec(episodeDir, {episodeRef, version})`**, in `@studio/episode` (`spec-init.ts`, beside `initEpisodeSpec`). It re-pins the spec to a newer release of the same template:
   - the pin becomes the new id, version and manifest hash;
   - `revision` goes up by one;
   - `data` is kept, and must validate against the new release's schema.

   It refuses:
   - no spec (`missing-spec`);
   - a version not greater than the pinned one (`bad-version`);
   - a missing release (`missing-template`);
   - data the new schema rejects (`bad-spec`, with the schema's paths).

   It writes atomically. The Pi tool is `pva_upgrade_spec` (channel, series, episode, version).
6. **No kit or compiler version.** A template release names its compiler and validator by version, and a new template release on a new theme keeps them. The look is data (ADR-0040).

## Settled by the prototype (2026-10-08)

- **Sealing and releasing live in `@studio/runtime`**, beside `sheet-review.ts`. The CLI is the runtime's, and the runtime does not depend on `@studio/episode`.
- **The tests are split the same way.**
  - The runtime tests `sealTheme`, `releaseTemplate` and the CLI on the Dentro i versi fixtures.
  - The episode tests the loader and `upgradeEpisodeSpec` on a release its test makes by hand, the way the runtime makes it.
- **Loader warnings are located findings.**
  - `theme-unsealed` comes first in `checkEpisode`'s findings, as a warning.
  - It comes first in `compileEpisode`'s warnings, as `code at path: message`.
  - The long's golden check now expects it, because the fixture theme stays unsealed.
- **`upgradeEpisodeSpec` also refuses another episode's spec** (`episode-mismatch`) and a broken release (`bad-template`). A draft's unfilled values don't stop the move.

## Testing

- **Contract:**
  - `files` accepted;
  - `unlisted-file`;
  - `unused-file`;
  - a bad hash format refused by the schema.
- **Loader:**
  - a sealed theme loads;
  - a changed room image stops with `theme-mismatch` at its path;
  - an unsealed theme loads with the `theme-unsealed` warning, reaching `compileEpisode`'s warnings.
- **`sealTheme`:**
  - the hashes are written, and the returned hash is that of the new `theme.json`;
  - refusals: `sealed`, `pinned`, `missing-file`.
- **`releaseTemplate`:**
  - the new release validates;
  - its theme pin is the sealed theme's hash;
  - an episode compiles on it after `upgradeEpisodeSpec`;
  - refusals: `release-exists`, `bad-version`, `theme-unsealed`.
- **`upgradeEpisodeSpec`:**
  - the pin and revision move;
  - the data is unchanged;
  - refusals: `missing-spec`, `bad-version`, `missing-template`, `bad-spec`.
- **CLI:** `vpr theme seal` and `vpr template release` print the new hash and release.
- **Agent:**
  - `pva_upgrade_spec` is listed (the extension test's tool count);
  - its errors reach Pi as `❌`.

## Out of scope

- The new rooms themselves and the re-run of both Il lampo episodes (`avg-dcf.6.7`).
- Sealing the fixture theme `dentro-i-versi@1.0.0`, which its template releases pin: it stays unsealed, with its warning.
- A Pi tool for releasing. Releasing is the operator's editorial act (ADR-0040: "data, reviewed like data"), done with `vpr`.
