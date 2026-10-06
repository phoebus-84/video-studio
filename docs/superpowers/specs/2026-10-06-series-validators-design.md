# Series validators: mechanical series rules on what is rendered

**Issue:** `avg-jao.3` — series validator hooks
**Epic:** `avg-jao` — data-driven series templates and series compilers (the `cs-port` plan)
**Builds on:** [series templates](../../adr/0037-series-templates-pin-editorial-standards.md) (ADR-0037, `avg-jao.1`); [series compiler](2026-10-06-series-compiler-design.md) (`avg-jao.2`); [timeline cutover](2026-10-06-timeline-cutover-design.md) (ADR-0036)
**Related:** `avg-jao.6` (golden references, split from this issue); `avg-3th.1` (layout sheet), `avg-jao.4` (pipeline stages) — the future callers of the check
**Reference:** CreativeStudio `formats/poesie-museo-long/hooks.py` (`validate`, `_audit`; read only)
**Date:** 2026-10-06

## Problem

A series template release fixes a format; its compiler turns a spec into a
timeline that respects it. Nothing checks that what is **rendered** still
respects it. A timeline can be edited by hand (ADR-0036 renders hand edits as
they stand), and a spec can be filled with content the format does not allow
— a narration too long for a short, say. CreativeStudio's format hooks fail
closed on such mechanical rules (duration range, altered takes, text equals
voice, forbidden effects). `SeriesTemplate.validator` names a validator;
nothing resolves it.

## Decisions taken with the user

1. **Validators only.** Golden-reference trust, signature verification,
   promotion and withdrawal (ADR-0037's other `avg-jao.3` item) move to a new
   issue, `avg-jao.6`.
2. **The rules apply to what is rendered**, hand edits included. A hand edit
   may change what the series allows (when pictures change, how captions
   are split); anything else is a format violation that blocks the render.
3. **Validators live beside the compilers in `@studio/series`, pure and
   frozen by a golden** (cases with their exact findings), versioned
   separately from compilers.
4. **The `poetry-short@1.0.0` rules and numbers** below (10–60 s; a picture
   held over 7 s is a warning).
5. **A check that writes nothing** (`pva_check_episode`), so the future
   sheet and pipeline stages can block on it.

## Design

### Interface (`studio/series/src/types.ts`, additions)

```ts
interface ValidateInput extends CompileInput {
  /** The timeline about to be rendered: stored (possibly hand-edited) or fresh. */
  timeline: EditTimeline;
  /** What the release's compiler makes of the same inputs: the reference. */
  compiled: EditTimeline;
}
interface Finding {
  code: string;
  severity: "error" | "warning";
  /** $.tracks[…] / $.profile / $.durationInFrames point into `timeline`; $.data… into the spec. */
  path: string;
  message: string;
}
interface SeriesValidator {
  id: string;            // ^[a-z0-9]+(-[a-z0-9]+)*$
  version: string;       // x.y.z
  description: string;
  validate(input: ValidateInput): Finding[];
}
```

- `VALIDATORS`, `resolveValidator(id, version)`, `listValidators()` in
  `src/validators.ts`, as the compiler registry.
- `checkSeries(input: ValidateInput): { validator: string | null; findings: Finding[] }`:
  a template without `validator` → `{ validator: null, findings: [] }`; a
  validator not registered → one error `unknown-validator` at
  `$.template.validator`, listing the available versions of that id;
  otherwise `{ validator: "<id>@<version>", findings }`, findings in the
  order the validator gives them.
- Validators are pure (no file, clock, randomness or environment), never
  mutate their input, and are deterministic. A version file
  (`src/validators/<id>/<version>.ts`) imports only `@studio/contracts`
  helpers and `../../types.js`, and keeps its helpers inside the file.
- A validator does not import a compiler: it receives `compiled`.

### Frozen by a golden

`fixtures/validators/<id>/<version>/cases.json`:

```jsonc
{
  "compiler": { "id": "poetry-short", "version": "1.0.0" }, // input.json and expected-timeline.json of this compiler fixture
  "cases": [
    {
      "name": "a caption rewritten by hand",
      "set": [{ "path": "$.tracks[1].items[0].props.text", "value": "Light falls across the room." }],
      "expect": [{ "code": "text-not-voice", "severity": "error", "path": "$.tracks[1]" }]
    }
  ]
}
```

- Each case starts from the compiler fixture's `expected-timeline.json` as
  `timeline` (and as `compiled`), applies `set` (dotted/indexed JSON paths;
  a value of `null` deletes the key) to `timeline` only, and may also
  `setInput` on the compile input (for content such as a too-long
  narration, where `compiled` must be recompiled — see testing).
- `test/validators-golden.test.ts` runs every case of every registered
  validator version and compares `[code, severity, path]` exactly, in
  order. A case may not be removed or changed; a new rule is a new version.
  Messages are not part of the golden.

### `poetry-short@1.0.0` (validator)

Checked on `timeline`, with `compiled` as the reference. 30 fps.

**Errors**

| Code | Rule | Path |
|---|---|---|
| `profile-changed` | `timeline.profile` deep-equals `compiled.profile` | `$.profile` |
| `fps-changed` | `timeline.fps` equals `compiled.fps` | `$.fps` |
| `duration-range` | 300 ≤ `durationInFrames` ≤ 1800 (10–60 s) | `$.durationInFrames` |
| `extra-track` | track ids are exactly `panels` (visual), `captions` (visual, optional when the narration has no words) and `voice` (audio); any other track | `$.tracks[i]` |
| `hidden-track` | no track `hidden` or `muted` | `$.tracks[i]` |
| `stacking-changed` | a track present in `compiled` keeps its `z` | `$.tracks[i].z` |
| `forbidden-kit` | `panels` items use `still@1.0.0`; `captions` items use `data.style.captionKit` | `$.tracks[i].items[j].kit` |
| `forbidden-transition` | a visual item has no `transitionOut`; its `transitionIn`, if any, is `{ type: "crossfade", duration: 12 }` | `$.tracks[i].items[j]` |
| `altered-voice` | the `voice` items equal `compiled`'s in number and, item by item, in `from`, `duration`, `asset`, `trimStart` (absent = 0), with no `gain`, `fadeIn`, `fadeOut`, `transitionIn`, `transitionOut` | `$.tracks[i].items[j]` (or `$.tracks[i]` for a count difference) |
| `asset-changed` | `timeline.assets` equal `compiled.assets`, id by id (no file swapped, added or removed by hand) | `$.assets["<id>"]` |
| `text-not-voice` | the `captions` items' `props.text`, in `from` order, joined by spaces and whitespace-collapsed, equal `compiled`'s captions joined the same way (what the compiler captioned from the voice: it drops a caption shorter than a frame) | `$.tracks[i]` |
| `missing-picture` | every `data.panels[k].assetId` is shown by at least one `panels` item (`props.src.$asset` = `image-<assetId>`) | `$.data.panels[k]` |
| `uncovered-frames` | the union of `panels` items covers every frame in [0, `durationInFrames`) | `$.tracks[i]`, message names the first uncovered frame |

**Warnings**

| Code | Rule | Path |
|---|---|---|
| `panel-flash` | a `panels` item visible for fewer than 30 frames (its `duration`) | `$.tracks[i].items[j]` |
| `panel-long` | a `panels` item longer than 210 frames (7 s) | `$.tracks[i].items[j]` |
| `caption-long` | a caption's text longer than 42 characters | `$.tracks[i].items[j]` |

Rules are evaluated in the order of the tables; each rule reports every
offending element. A missing track (e.g. no `voice`) is `extra-track`'s
counterpart: `missing-track` (error, path `$.tracks`), checked first.

### Agent — `studio/agent/src/series-compile.ts`

- `loadEpisode(episodeDir, { episodeRef })` → `{ ok: true, input: CompileInput, template, releaseKey } | { ok: false, problems }`:
  today's loader steps, without compiling. `compileEpisode` becomes
  `loadEpisode` + `compileSpec` (unchanged results).
- `checkEpisode(episodeDir, { episodeRef, timeline? })` → `{ ok: true, compiled, validator, findings } | { ok: false, problems }`:
  load, compile (`compiled`), then `checkSeries` on `timeline ?? compiled`.
  Findings' paths are located like problems: `$.tracks…`, `$.profile`,
  `$.durationInFrames` → `artifacts/edit-timeline.json#…`; `$.data…` →
  `episode-spec.json#…`; `$.template.validator` → the release manifest's
  `#$.validator`.

### Agent — `studio/agent/src/episode-render.ts`

- `currentEditTimeline` is split: `decideEditTimeline(episodeDir, options)`
  returns the decision without writing — `{ timeline, text, hash, rebuilt,
  compiledBy, warnings, problems? }` (`rebuilt` names why a fresh timeline
  replaces the stored one) — and `currentEditTimeline` applies it (backup and
  write when `rebuilt`). Behaviour of `currentEditTimeline` is unchanged.
- For a spec-driven episode the decision also carries
  `validation: { validator, findings }`, from `checkEpisode` on the chosen
  timeline.
- `writeEditTimeline` (build): compile, check; any error-severity finding →
  `TimelineBuildError` listing the findings, nothing written; warnings
  returned.
- `renderEpisode`: after the decision, any error finding → a
  `SeriesRulesError` (code `series-rules`, `problems` = the findings) before
  anything is written: no rebuild written, no render, `output/` unchanged.
  Otherwise the render goes on; warnings are added to the reply and the
  report gets `validation`.

### Tools

- `pva_build_timeline`: as now, plus findings — errors fail the tool
  (`❌ series rules (poetry-short@1.0.0): …` with each finding located),
  warnings are listed with `⚠️`.
- `pva_compose_video`: errors fail the tool with the findings and, when the
  timeline is a stored one (not rebuilt), the hint: fix the edit, or delete
  `artifacts/edit-timeline.json` to recompile. Warnings in the reply; the
  report's `validation`.
- **`pva_check_episode { channel, series, episode, profile? }`** (new): the
  decision `pva_compose_video` would take, without writing anything — which
  timeline (`as it stands` or `would be recompiled: <reason>`), and the
  findings, or "no series rules" for an episode without a spec or a
  template without a validator. Not queued on `current.json` (it writes
  nothing). It is the check `avg-3th.1` and `avg-jao.4` will block on.
- Episodes without a spec: unchanged.

### Docs

- ADR-0037: a "Series validators" section — pure, versioned beside
  compilers, frozen by golden cases, applied to whatever is rendered, errors
  block; golden-reference integration is `avg-jao.6`; status updated.
- `studio/series/README.md`: validators, the golden cases, adding a version.
- `skills/studio/compose-video.md` (0.4.0): findings, what a hand edit may
  change, `pva_check_episode`.
- The tool list in the agent docs/skill where tools are enumerated.

## Testing

- **`@studio/series`**:
  - golden cases for `poetry-short@1.0.0`: the untouched compiled timeline
    (no findings); one case per error and warning rule; a legitimate hand
    edit (a picture change moved by 10 frames, a caption split in two at a
    word boundary) with no findings; a narration content case through
    `setInput` (holdSeconds raised to 60 → `duration-range`, recompiled
    `compiled`);
  - `checkSeries`: no validator → `null` and `[]`; unknown validator →
    `unknown-validator` with the list; determinism; input not mutated;
    registry ids and versions well formed and unique.
- **Agent loader**: `checkEpisode` on a complete episode → no errors; on a
  hand-edited timeline with a rewritten caption → `text-not-voice` at
  `artifacts/edit-timeline.json#$.tracks[1]`; `compileEpisode` results
  unchanged (existing tests).
- **Tools** (fake renderer):
  - `pva_build_timeline` with a spec whose hold makes it longer than 60 s:
    error, nothing written;
  - `pva_compose_video` refuses a stored hand edit that breaks a rule (no
    render, `output/` unchanged, the hint); renders a legitimate edit as it
    stands; the report's `validation` holds the warnings;
  - `pva_check_episode` leaves every file byte-identical and reports the
    same decision as compose (as it stands / would be recompiled and why);
    on a legacy episode says there are no series rules;
  - the jao.2 test that hand-edited a caption becomes a `text-not-voice`
    refusal; its "as it stands" check uses a moved picture change.
- **End to end** (`REMOTION_E2E=1`): the existing renders still pass.
- Root: `npm run check`, `npm run docs:build`.

## Out of scope

Golden references (`avg-jao.6`); the layout sheet (`avg-3th.1`) and the
render audit (`avg-3th.3`); pipeline stages (`avg-jao.4`); evidence reports
(voice/rights verification, CreativeStudio's `ok: true` files); rules for
"Dentro i versi" series (their validators come with their compilers in
`avg-dcf`).
