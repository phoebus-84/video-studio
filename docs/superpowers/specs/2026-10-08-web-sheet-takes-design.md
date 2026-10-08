# The web studio for a series episode: the sheet to review, the takes to hear

**Issue:** `avg-goz`.
**Asked by the user, 2026-10-08:** "to see a layout sheet I dig through files, then approve with a CLI command; the web GUI has a Storyboard tab, empty." Then: "connect Narration to the audio too."
**Design agreed in chat (2026-10-08).**
**Builds on:**
- the layout sheet (`avg-3th.1`) and its signed review (`avg-3th.2`, `vpr sheet`);
- registered takes (`avg-dcf.6.6`) and their alignment;
- pinned sources (ADR-0035);
- the web operator credential (`avg-qr4.3`).

**Date:** 2026-10-08

## Problem

A spec-driven episode (one with `episode-spec.json`, like the Il lampo short and long) has a layout sheet to review and narration takes to hear. The web studio shows neither:
- **Storyboard** lists the explainer's scenes, which a series episode has none of.
- **Narration** lists the explainer's narration segments and synthesizes them from the browser.

So the person opens `sheet.jpg` from the file system and approves it with `vpr sheet approve` in a terminal. They can't listen to the takes, or see whether their alignment matches.

## Decisions

1. **The gateway reads a series episode** in a new route module, `routes/series-episode.ts`, registered beside the production routes. It never writes anything except a review the operator signs. The paths are the episode routes' (`/api/channels/:c/series/:s/episodes/:e/…`).
   - `GET …/layout-sheet` answers:
     - `specDriven`: whether there is an `episode-spec.json`;
     - `sheet`, or `null` when none was made: `createdAt`, `scale`, `columns`, `rows`, the grid's path and hash, each still's `index`, `frame`, `seconds`, `label` and `path` (relative to the episode);
     - `timelineChanged`: whether the timeline the sheet pictured (`sheet.json`'s `timeline.hash`) is no longer `artifacts/edit-timeline.json`. The render gate checks the rest (kits, composer, rules); the page says so.
     - `review`: the runtime's `sheetReviewStatus`, verified with the gateway's operator key: `state` (`no-sheet`, `unreviewed`, `approved`, `rejected`, or the problem state), `verified`, `at`, `note`, `message`.
   - `POST …/layout-sheet/review`, with body `{decision: "approved" | "rejected", note?, sheetHash}`:
     - Only the operator: the request's principal must be `operator`. Anything else is 403 `operator-only`, and nothing is written; Pi can't approve.
     - `sheetHash` must be the hash of the grid now on disk, or the answer is 409 `sheet-changed`. The person signs the sheet they saw, not one Pi remade meanwhile.
     - A rejection needs a note (400, as `vpr sheet reject`).
     - It then calls the runtime's `reviewSheet`, the same call as `vpr sheet approve|reject`, with the gateway's operator key, and answers its outcome.
   - `GET …/narration-takes` answers:
     - `specDriven`;
     - `units`: `artifacts/narration/takes.json`'s units in order, each take with its `pauseBefore`;
     - `takes`: each take's `id`, `text`, `spokenText?`, `language?`, `role?`, `voice`, `durationSeconds`, `audio` (`{channel, series, episode, path}`, which the web fetches through the file route), and `words` (its timing's `{text, start, end}`, or `null` when not aligned);
     - `sources`: for each pin of `kind: episode` (`source/pins/*.json`), the source episode's ref, the pin id and its takes, in the same shape and read-only.

     A missing `takes.json` answers empty lists, not an error.
2. **Media through the existing file route.** The web fetches the stills, the grid and the takes' audio with the bearer header and plays or shows them as blob URLs, as `files-store` already does. The token never goes in a URL. A pinned take's audio is fetched from its own episode's file route.
3. **Storyboard, spec-driven.** When `GET layout-sheet` says `specDriven`, the Storyboard tab shows `SheetReview`:
   - a status line;
   - the stills in a grid, each with its number, time (`mm:ss.ff`) and label;
   - a lightbox on click, with ← → between stills and Esc to close;
   - Approve and Reject (Reject asks for a note).

   The status line shows one of:
   - "No sheet yet: Pi makes it (pva_layout_sheet)";
   - "The timeline changed since this sheet: make it again";
   - "Not reviewed";
   - "Approved at … (verified)";
   - "Rejected: <note>".

   The buttons are enabled only when the browser holds the operator key (`hasOperatorKey()`); otherwise the line "Sign in as operator to review" appears, as in the stage panel. After a review the panel reloads. A non-spec episode keeps the scene storyboard unchanged.
4. **Narration, spec-driven.** When `GET narration-takes` says `specDriven`, the Narration tab shows `TakesPanel`:
   - each unit in order, its takes with the pause before each;
   - per take:
     - id and duration;
     - the voice (provider · voiceId), with the direction on hover;
     - an "aligned" or "not aligned" badge;
     - the text, with the spoken text when it differs;
     - a play button.
   - **While a take plays, its current word is lit** (from `words`, by the audio's `currentTime`).
   - **Pinned takes** follow, under "From <pin> (<series>/<episode>)", read-only like the rest.
   - Nothing here synthesizes or registers: that stays Pi's (`pva_synthesize_speech`, `pva_register_take`).
5. **Pure helpers, tested:**
   - `lib/sheet-review.ts`: `sheetStatusLine(answer)`, `formatSheetTime(seconds)` (`mm:ss.ff`), `nextStill(i, n, step)`;
   - `lib/narration-takes.ts`: `wordAt(words, t)`, the index of the word being said at `t`, or −1 between words.

## Settled by the review (2026-10-08)

- **The review's when, who and why.** The runtime's verdict says whether a review holds, not when or why. The route adds `at`, `actor` and `note` from the signed `review.json` for an approved or rejected sheet, so a rejection shows its note.
- **"The timeline changed" only when it did.** A sheet made for a timeline the render would rebuild (`rebuilt`), or before any timeline was stored, pictured no stored file, so neither counts as a change.
- **`sheet.json` is held to the sheet's names.**
  - The grid must be `sheet.jpg` and the stills `frames/NNN.jpg`.
  - The timeline must be `artifacts/edit-timeline.json`.
  - Anything else is `invalid`, with no sheet, so there is nothing to review.
- **Not reviewable:** an invalid sheet, or stills that aren't the ones described (`no-sheet` with a sheet). A review of an earlier sheet (`stale`) leaves this one to review.
- **The tabs fall back.** A gateway error shows the episode's other view under a note, and a reload keeps the shown answer until the new one comes.
- **Playback can't overlap.** A play that resolves after another click, or after the tab closed, is dropped and its blob revoked; `play()` failures are reported. Rows are keyed by their place, not the take id, which may repeat.
- **The lightbox takes the focus,** keeps Tab inside, and gives the focus back to the still it came from.

## Testing

- **Gateway** (vitest, a bare Fastify with the test principal hook, as `take-routes.test.ts`):
  - `layout-sheet`: a spec-driven episode with no sheet, with a sheet, and with a changed timeline; a non-spec episode.
  - `layout-sheet/review`:
    - the agent is refused 403 with nothing written;
    - the operator approves, and `review.json` verifies with the key;
    - a stale `sheetHash` gets 409;
    - a rejection without a note gets 400;
    - a rejection with a note is recorded.
  - `narration-takes`: units and takes with words, a take without timing (`words: null`), a pinned source's takes, and no `takes.json`.
- **Web** (unit):
  - `wordAt` at a word, between words, before the first and after the last;
  - `sheetStatusLine` for each state;
  - `formatSheetTime`;
  - `nextStill` wraps.

## Out of scope

- Making the sheet or a take from the web.
- Comments on a still.
- Stills larger than the sheet's scale. They are drawn at `scale` (0.25 by default: 480×270); a full-size frame on click is a follow-up.
