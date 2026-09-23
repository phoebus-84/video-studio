# One definition of an episode

Design, 2026-09-23. Issue: avg-ez3.

## 1. The problem, stated correctly

The issue was filed as "the workspace contract and the library disagree", with
evidence that 11 episodes carry `episode.json`, 10 carry `episode.yaml`, and 9
carry neither. That framing was wrong in a way worth recording: it implied two
formats drifting apart over time.

They are not drifting. **One function writes both**, in one call —
`studio/agent/src/workspace-authoring.ts` writes `episode.json` at line 274 and
`episode.yaml` at line 290. The ten episodes holding both are not casualties of
drift; they are what that creator produces.

The real defect is that nothing owns the definition of an episode. Five separate
declarations of "what an episode is" exist in the tree, and the two that are
load-bearing are not the two that look canonical.

### The five declarations

| Declaration | Written by | Read by |
| --- | --- | --- |
| `episode.yaml` | both creators | nothing parses it; `tree.ts` lists it, `doctor.ts` checks it exists |
| `[episode]/episode.json` | the agent's creator | nothing reads its contents; used only as a lock path for `withFileMutationQueue` at `workspace-tools.ts:134` |
| `artifacts/episode.json` | the agent's creator | **genuinely load-bearing** — `gateway/src/workspace/scene-spine.ts` treats it as the winning scene source; the web AssetPanel writes scene intent and TTS instruct into it |
| `EpisodeMetadata` in `workspace.schema.json` | nothing | nothing — declared, bound to TypeScript in `bindings/ts/workspace.ts:115`, referenced only by `WorkspaceExample` |
| `.workspace/contract.json` | both creators | the workspace-kind marker — a different job, working correctly |

Two documents share the basename `episode.json` at different depths and mean
entirely different things. One is episode identity, the other is a scene spine.

### The two creators disagree

| | `agent/workspace-authoring.ts::createEpisode` | `runtime/workspace/init.ts::createEpisodeSkeleton` |
| --- | --- | --- |
| `episode.yaml` | yes, with slug, title, createdAt | yes, with slug and createdAt only |
| `episode.json` | yes | no |
| `artifacts/episode.json` | yes | no |
| `production/` | yes, line 262 | no |
| `assets/animation` | yes | no |
| `assets/images`, `assets/graphics` | no | yes |

`EPISODE_TREE` in `runtime/src/workspace/tree.ts` — the list `doctor` validates
against — names `episode.yaml` and neither `episode.json` nor `production/`. It
describes the runtime's creator and not the agent's, so an episode made by the
agent carries two files and a directory the contract has never heard of, and an
episode made by the runtime is missing three things the agent's episodes have.

### What `production/` actually is

Created by the agent's creator at line 262. **Written by no code anywhere in the
repository.** Its contents across the five episodes that have anything in it are
`animated-scenes`, `cinematic-v2`, `hybrid-v1`, `pipeline-smoke` and
`remotion-infographic` — hand-named experiment directories.

Verified: **zero journal events in the entire library reference `production/`**,
and every recorded stage output resolves inside `artifacts/`. Nothing a pipeline
declares lives there. It is a scratch area that grew where nobody declared one.

## 2. Decisions

1. `episode.yaml` becomes the one episode manifest, actually parsed and
   validated, conforming to a new `EpisodeManifest` contract.
2. `[episode]/episode.json` is folded into it and retired.
3. `artifacts/episode.json` and `.workspace/contract.json` are **not touched**.
   They are different concepts; renaming or merging them is not this issue's
   business.
4. `production/` is declared as the episode's scratch area.
5. Existing episodes are migrated on a best-effort basis. An episode that
   migrates cleanly is migrated; one that does not is reported and skipped.
   Old episodes are not worth elaborate machinery.

## 3. The contract

### A new `EpisodeManifest`, and `EpisodeMetadata` is left alone

An earlier draft of this spec had `episode.yaml` conform to the existing
`EpisodeMetadata`, with its required `settings` relaxed. That was wrong, and the
reason matters: `EpisodeMetadata` also requires `episodeId` and `seriesId`,
which are ULIDs (`ep_01ARZ3NDEKTSV4RRFFQ69G5FAV`). **The file on disk is
addressed by path and slug, not by ULID.** Conforming to it would mean minting
identifiers for all 20 existing episodes during migration — inventing facts to
satisfy a contract, in a migration whose whole discipline is not inventing
facts.

So `workspace.schema.json` gains a new `EpisodeManifest` definition for the
on-disk file, and `EpisodeMetadata` is not touched at all.

This is the lower-risk change as well as the more honest one. No published
`required` is loosened, so nothing already written against the schema can break.
And the two describe genuinely different things: `EpisodeMetadata` is the
id-addressed aggregate view used by `WorkspaceExample`; `EpisodeManifest` is the
path-addressed file the filesystem holds. Each schema carries a `description`
pointing at the other so the next reader does not have to rediscover this.

### `settings` is optional in `EpisodeManifest`

`docs/workspace.md` defines settings as resolving
`system -> channel -> series -> episode`, and only the channel and series levels
have a `settings.yaml` — confirmed in `runtime/src/workspace/tree.ts`, where
`settings.yaml` appears in `CHANNEL_TREE` and `SERIES_TREE` and in no episode
list.

Requiring a complete `SettingsLayer` — `approvalPolicy`, `budget`,
`outputProfile`, all three mandatory — at the leaf of an inheritance chain would
contradict the inheritance the leaf participates in. An episode that overrides
nothing would have to restate everything it inherits, and the restatement would
immediately become a second source of truth for values the channel and series
own.

Episode-level overrides live under an optional `settings:` key inside
`episode.yaml`.

### The fields

Required: `apiVersion`, `kind: Episode`, `slug`. Optional: `channel`, `series`,
`title`, `description`, `createdAt`, `settings`.

`slug` alone is required because it is the one fact every episode has and the
one the directory name already proves. `channel` and `series` are optional
because the path proves them too — they are recorded for a file that gets copied
or moved out of its tree, not relied on for resolution.

### `description` is added

The retired `episode.json` carried a `description`, and it is editorial content
worth keeping — `giulio-cesare` uses it to record the episode's editorial
premise. It is optional.

### `createdAt` is optional

See the migration: the eight bare episodes have no recorded creation time, and
inventing one would be fabricating a fact. Absent is the honest value.

### Why YAML

`docs/workspace.md` already rules the file-ownership question: YAML is
declarative configuration, JSON is generated manifests and reports. An episode
manifest is declarative configuration. This also matches what `EPISODE_TREE` and
`doctor` already look for, so the contract moves toward what the validator
already believes rather than away from it.

## 4. One skeleton, two creators

The episode tree definition moves into `@studio/contracts/src/layout.mjs`.

This placement is forced by the dependency graph rather than chosen for
elegance: `studio/agent` depends on `@studio/contracts` and **not** on
`@studio/runtime`. Contracts is the only module both creators can read from
without adding a dependency that `tools/check-boundaries.mjs` exists to
discourage. It is also where the layout already lives, which is the point of
that module.

`runtime/src/workspace/tree.ts` re-exports the definition so `doctor` and every
other consumer are unchanged. Both creators build their tree from the one list.

The unified skeleton takes the union of what the two creators make today, not
the intersection. `assets/animation` joins it on evidence: `discovery.ts:19` maps
the `animated-visuals.mp4` artifact contract to `assets/animation/visuals.mp4`,
and `capability-tools.ts:362` writes rendered animations there, so an episode
without it is missing a directory the artifact resolver already looks in.
`production/` joins it for the reason given in section 5. Eleven episodes already
hold `assets/animation` and twelve hold `production/`.

An empty `production/` in every episode is accepted deliberately rather than
made conditional: one list that both creates and validates is simpler than two
lists distinguishing "created" from "required", and the agent's creator already
behaves this way today.

A test pins that **both creators produce exactly the declared tree**. This is the
technique `studio/runtime/test/unit/engine/transition-table-agreement.test.ts`
already uses for `VALID_TRANSITIONS`, and it exists for the same reason: two
implementations of one meaning drift apart, and a comment telling the reader to
check the other copy is not a test.

## 5. `production/` as declared scratch

`layout.mjs` declares it, and the declaration carries the rule:

> No stage may declare an output inside the scratch area, and no artifact
> resolver may treat its contents as an artifact.

This is what converts avg-t7i from guesswork into a decision. `artifactExists`
currently misses real artifacts partly because it has no statement of where
artifacts are allowed to be. After this it has one, and excluding `production/`
becomes deliberate rather than accidental.

It also gives avg-lho.4 (scratch workspaces) an existing concept to build on
instead of inventing a parallel one.

## 6. Migration

`tools/migrate-episode-manifests.mjs`, in the established shape of
`tools/migrate-library-layout.mjs`:

```bash
node tools/migrate-episode-manifests.mjs --library ./library --dry-run
node tools/migrate-episode-manifests.mjs --library ./library
```

Idempotent — a library already migrated is left alone. Every step printed.
`--dry-run` shows the full plan before anything is touched.

### It does not reimplement the skeleton

A bare episode is missing far more than a manifest. Measured against
`EPISODE_TREE` for `cinderella`, **12 of the 15 required entries are absent** —
only `artifacts/`, `assets/` and `assets/images/` exist. Migration therefore has
to create `source/`, `prompts/`, `assets/graphics`, `assets/audio`,
`assets/manifest.json`, `attempts/`, `reviews/threads.jsonl`,
`journal/events.jsonl`, `output/`, `output/current.json`,
`.workspace/contract.json` and `.workspace/metadata.json`.

The tool must not carry its own copy of that list. `init.ts` already creates the
skeleton idempotently — `writeIfMissing` plus `mkdir` that tolerates an existing
directory — so the migration **runs the canonical creator over each existing
episode directory**. Migration and creation are then the same code and cannot
disagree, which is the entire point of this issue.

### What it does per episode

1. If `episode.yaml` is absent, write it **first**, folding in
   `[episode]/episode.json` when present: `title`, `description`, `channel`,
   `series`. Where both files hold a value and the values differ, the existing
   `episode.yaml` wins and the conflict is printed.
2. Run the canonical episode creator over the directory. Everything already
   present is left untouched, including the `episode.yaml` just written — which
   is why step 1 comes first: the creator would otherwise write its own
   `episode.yaml` with a fabricated `createdAt`.
3. Retire `[episode]/episode.json` by renaming it to `.episode.json.migrated`.

### For the eight episodes with no manifest

`cinderella`, `hansel-and-gretel`, `little-red`,
`the-wolf-and-the-seven-little-kids`, `three-little-pigs`, `tom-thumb`, `tomb`,
`gpu-architecture`.

Slug comes from the directory name. Title is derived from the slug by replacing
hyphens with spaces and capitalising words. `createdAt` is **omitted** — these
episodes have no recorded creation time and a derived one would be a fabricated
fact in a file whose purpose is to be authoritative.

These happen to migrate cleanly, because the canonical creator is idempotent and
fills a bare directory as readily as an empty one. That is a convenience, not a
requirement: see below.

### Best effort, and what that rules out

Old episodes are migrated where migration is straightforward. Where it is not,
the tool **reports the reason and moves on**. A skipped episode is a normal
outcome printed in the summary, not a failure and not a non-zero exit.

Concretely, an episode is skipped rather than forced when:

- `episode.yaml` and `episode.json` both hold a `title` or `slug` and the values
  disagree — the tool prints both and changes nothing, because guessing which
  one a person meant is exactly the kind of inference this issue removes
- `episode.json` is present but unparseable
- the directory holds something unexpected where a required file belongs, for
  instance a file named `journal` or `output`

No reconciliation logic, no heuristics, no interactive prompting. The tool's
whole job is to make the easy majority conform and to say plainly which
episodes it did not touch and why.

Accepting that some old episodes stay non-conforming is a deliberate trade. The
contract binds what the system creates from now on; the back catalogue is
migrated as far as it goes cheaply.

### Nothing is deleted

The precedent tool promises that migration only ever moves things, and here the
promise is load-bearing rather than ceremonial: **`library/` is gitignored, so
there is no git history to recover a deleted file from.** The retired
`episode.json` is renamed, not removed. The leading dot marks it as metadata
under the rule already stated in `docs/workspace.md`.

## 7. Validation

`doctor` currently checks that `episode.yaml` exists. It will validate the
file's contents against the schema.

Checking presence while reporting validity is the same defect this repository
has been removing for three branches: a surface that reports something other
than what it holds. An empty or malformed `episode.yaml` passes the current
check.

### Tests

The real library cannot be a CI fixture — it is gitignored and holds gigabytes
of media. The test that would have caught this is a fixture library carrying one
of each historical shape:

- an episode with both manifests, as the agent's creator produces
- an episode with `episode.json` only, like `sleeping-beauty`
- a bare episode with `artifacts/`, `assets/` and `reviews/` only, like
  `cinderella`
- an episode already migrated, to prove idempotency

Plus the creator-agreement test from section 4, and a `doctor` test proving a
malformed `episode.yaml` is now reported rather than passed.

## 8. Non-goals

- Renaming `artifacts/episode.json` or changing the scene spine in any way.
- Implementing settings *resolution* through the inheritance chain. This makes
  the field legal to write; computing the resolved value is separate work.
- Fixing `artifactExists` (avg-t7i). This gives it the statement of where
  artifacts live that it needs, and stops there.
- Backfilling journals for the episodes that lack them (avg-7he).

## 9. What this unblocks

avg-t7i gains a declared answer to "where may an artifact be". avg-7he gains a
library where most episodes have an identity to key a journal to, and a printed
list of the ones that do not. avg-fe2, the vertical slice, stops failing for
reasons already understood — it runs on a new episode anyway, which the unified
creator now builds correctly by construction.
