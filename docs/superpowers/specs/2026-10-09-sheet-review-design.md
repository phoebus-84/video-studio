# Signed sheet review: a render needs a person to have read the sheet

**Issue:** `avg-3th.2` (epic `avg-3th`, QA, signed review and direct edits)
**Unblocks:** `avg-dcf.6`, `avg-dcf.7`
**Relates:** `avg-qr4.9`, `avg-qr4.11` (approval receipts and their inputs)
**Builds on:**
- the layout sheet (`avg-3th.1`): `artifacts/layout-sheet/sheet.json` with its `inputsHash` and the sheet's hash, and `layoutSheetStatus`;
- signed receipts (`avg-qr4.3`): HMAC with the operator key, held by the browser and the operator's CLI, never by Pi;
- golden references (`avg-jao.6`): the operator CLI's sign-and-write pattern.

**Date:** 2026-10-09

## Problem

The series-production pipeline puts a human review on its `sheet` stage. `renderEpisode` itself asks nothing, though: Pi's render tool, or anyone calling it, spends a render on a timeline whose sheet nobody read, or read before it changed. CreativeStudio refused to render without an attested review of the current sheet (`studio review` then `render`).

## Decisions

1. **The gate's strictness was chosen by the user, 2026-10-09.**
   - With the operator key, a render requires a verified, signed approval of the current sheet.
   - Without it (Pi never holds it), a render still requires an approval bound to the current sheet's hashes; it cannot verify the signature. Forgery by a same-user process is `avg-qr4.8`'s OS isolation, as for takes and gate receipts.
2. **The review is a signed gate review of the sheet.** Its stage is `layout-sheet` and its decision is `approved` or `rejected` (a rejection carries a note). Its binding:
   - `planHash` is the sheet's `inputsHash`, without its `sha256:` prefix;
   - `outputs` are `sheet.json` and the grid image, by hash;
   - `episode` is the episode's slug.

   It is built by `buildSheetReview` and checked by `verifySheetReview` in `@studio/contracts`, as references are.
3. **It lives in `artifacts/layout-sheet/review.json`.** Regenerating the sheet replaces the whole folder, so a new sheet always starts unreviewed. That is the issue's "regenerating the sheet clears it".
4. **The operator signs from the CLI:**
   - `vpr sheet approve <channel>/<series>/<episode> [--note <text>]`;
   - `vpr sheet reject <channel>/<series>/<episode> --note <text>`;
   - `vpr sheet status <channel>/<series>/<episode>`.

   The CLI signs exactly the sheet on disk: it refuses when `sheet.json` is missing or unreadable, or when the grid image's bytes do not hash to what `sheet.json` says. Whether the sheet still matches the timeline is the render's question: the runtime does not depend on the episode package.
   - A web button that signs through the gateway is a follow-up (`avg-3th.2.1`): the gateway holds the key, but its routes are their own change.
5. **The render gate.** For an episode with a spec (series-driven), `renderEpisode` refuses before anything is written. The refusal is `SheetReviewError` with `code: "sheet-review"` and a single problem:

   | Problem | When |
   |---|---|
   | `sheet-missing` | there is no sheet |
   | `sheet-stale` | the sheet no longer pictures the timeline a render would use (its reasons listed) |
   | `review-missing` | nobody has reviewed the current sheet |
   | `review-rejected` | the reviewer rejected it (their note quoted) |
   | `review-stale` | the review's binding names another sheet |
   | `review-invalid` | the signature does not verify (only with the key), or the record is malformed |

   Episodes without a spec (the legacy explainer builder) are not gated, since their pipelines review differently.
6. **The key reaches `renderEpisode` as an option** (`operatorKey?: string | null`). Pi's tool and the series adapter pass none and get the hash-bound check. A process holding the key passes it.

## Design

- **`studio/contracts/src/sheet-reviews.mjs`** (with `.d.mts`):
  - `SHEET_REVIEW_STAGE = "layout-sheet"`;
  - `SHEET_REVIEW_FILE = "review.json"` (inside `artifacts/layout-sheet/`);
  - `buildSheetReview({episode, inputsHash, sheet: {path, hash}, report: {path, hash}, decision, note?, at?})` returns an unsigned gate review;
  - `verifySheetReview({review, key, episode, inputsHash, sheetHash, reportHash})` returns `{state: "approved" | "rejected" | "stale" | "invalid", verified: boolean | null, problem?}`.
- **`studio/runtime/src/sheet-review.ts`:** `reviewSheet({libraryRoot, ref, key, decision, note?, at?})` and `sheetReviewStatus(...)`.
- **`studio/runtime/src/cli.ts`:** the `sheet` command.
- **`studio/episode/src/sheet-review.ts`:** `requireSheetReview(episodeDir, options, decision, key)`, used by `renderEpisode` after the timeline decision and before anything is written.
- **`studio/episode/src/episode-render.ts`:** the gate and the `operatorKey` option.

## Testing

- **Contracts:**
  - a signed approval verifies;
  - a changed sheet hash is `stale`;
  - a tampered note is `invalid` with the key, and `approved` (unverified) without it;
  - a rejection needs a note;
  - another episode's review is `invalid`.
- **Runtime:**
  - approve writes a signed `review.json`;
  - it refuses with no key, with no sheet, and with an image that does not match `sheet.json`;
  - reject requires `--note`;
  - status reports the state.
- **Episode** (render and sheet faked):
  - a render with no sheet, a stale sheet, no review, a rejected review or a stale review is refused with its problem, and writes nothing;
  - an approved review lets it render;
  - with a key, a forged signature is refused;
  - regenerating the sheet clears the review;
  - an episode without a spec renders ungated.
- **The real short e2e** reviews its sheet (signs with a test key) before rendering.

## Documentation

- `docs/workspace.md`: the review file.
- The CLI's help.
- The runtime README's command list.
- The `review-layout-sheet` skill, if it names the step.
