# Workspace and policy contracts

Canonical definitions are in [`schemas/v1alpha1/workspace.schema.json`](../schemas/v1alpha1/workspace.schema.json). They describe workspace metadata, not filesystem discovery, atomic writes, ownership enforcement, or state transitions. Those behaviors belong to the pipeline runtime.

## Resource placement

| File / frontmatter | Contract definition | Purpose |
|---|---|---|
| `channel.md` frontmatter | `ChannelProfile` | Channel identity and audience |
| channel `settings.yaml` | `ChannelSettings` | Channel-level inheritance inputs |
| `series.md` frontmatter | `SeriesProfile` | Recurring format and channel relationship |
| series `settings.yaml` | `SeriesSettings` | Series-level inheritance inputs |
| `episode.yaml` | `EpisodeMetadata` | Episode identity, source references, episode settings, and optional path to the current pointer |
| `source/source.yaml` | `RepositorySourceSnapshot` or `TextSourceSnapshot` | Immutable input evidence and license status |
| `voice-profiles/*.md` frontmatter | `VoiceProfileMetadata` | Revisioned voice intent, never raw voice secrets or embeddings |
| `visual-bible.md` frontmatter | `VisualBibleMetadata` | Revisioned series art-direction identity |
| `output/current.json` | `CurrentDeliverable` | Hash-backed pointer to a verified render and its report |

A `WorkspaceExample` exists only for contract fixtures. Runtime code persists the constituent resources at their locations in [`WORKSPACE.md`](../../WORKSPACE.md).

## Explicit inheritance inputs

`ChannelSettings`, `SeriesSettings`, and Episode metadata each carry a complete `SettingsLayer`. Configuration resolves in the fixed order `system → channel → series → episode`; the runtime must materialize the resolved result into the immutable Pipeline Snapshot. Consumers do **not** independently fill missing policy defaults.

Every settings layer explicitly supplies:

- an `ApprovalPolicy` with `autopilot`, `guided`, or `manual` mode;
- every paid-action and stop-condition decision;
- a currency-safe `BudgetEnvelope` in integer micros;
- the selected output profile; and
- optionally a BCP-47 locale and preserved namespaced extensions.

Budget policy has no floating-point currency. The schema requires an explicit warning level; semantic validation rejects a warning threshold above the hard limit. Budget overflow, material downgrade, missing capability, validation failure, edit conflict, and license/safety blockers always require approval, including in autopilot. Only ordinary paid actions may be explicitly continued under an approved policy.

## Pinned source snapshots

Repository documentation must use `RepositorySourceSnapshot`:

- `originUri` is credential-free;
- `commit` is a full, lowercase 40-character Git commit, not a branch, tag, or ref name;
- `treeHash` records the captured tree bytes;
- license metadata states commercial-use and attribution status with evidence; and
- `analysisPolicy` is fixed to `{ "readOnly": true, "allowRepositoryExecution": false }`.

Text input uses `TextSourceSnapshot`, which requires an absolute credential-free source URI, immutable revision token, and content hash. A mutable URL alone is not a source snapshot. Signed URLs, query credentials, authorization headers, local absolute paths, and repository execution permissions are prohibited from canonical state.

## Current deliverable rule

`output/current.json` is an explicit `CurrentDeliverable`, not a convenient filename or symlink. It identifies its episode, immutable render attempt, portable media path, media hash/byte length, revisioned render report, and update instant. The runtime must set it only after delivery QA and stale-dependency policy pass.

## Markdown frontmatter

Voice Profiles and Visual Bibles keep prose in Markdown bodies. Their typed frontmatter tracks artifact ID, revision, and creation time. A cloned voice additionally references the reviewed source revision; binary audio and embeddings remain separate immutable assets.

## Validation

```bash
npm run check:schemas
```

The command validates fairy-tale and pinned-repository fixtures with JSON Schema Draft 2020-12 and runs cross-document semantic checks. The fixture suite proves rejected mutable commits, absent hashes, traversal paths, hidden stop conditions, unsafe budget thresholds, missing clone sources, license attribution gaps, and unowned secret-bearing fields.
