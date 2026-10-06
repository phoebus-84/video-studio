# Golden references: propose, approve, verify, withdraw

**Issue:** `avg-jao.6` — golden references: verify, promote and withdraw series references
**Epic:** `avg-jao` — data-driven series templates and series compilers (the `cs-port` plan)
**Builds on:** [series templates](../../adr/0037-series-templates-pin-editorial-standards.md) (ADR-0037, "Golden references are evidence, not live pointers"); [series validators](2026-10-06-series-validators-design.md) (`avg-jao.3`); [series pipeline](2026-10-06-series-pipeline-design.md) (`avg-jao.4`); signed receipts and the operator key (`avg-qr4.3`)
**Blocks:** `avg-jao.5` (version compare against references)
**Date:** 2026-10-06

## Problem

ADR-0037 defines a `SeriesReference`: an approved episode of a series kept as
evidence of the series' standard — frozen spec and timeline snapshots, the
immutable render and report, and the operator's signed approval bound to all
four. `avg-jao.1` shipped the descriptor's shape and `validateSeriesReference`,
which the ADR says is *not* proof of approval. Nothing makes a reference,
nothing verifies one, and nothing withdraws one.

## Decisions taken with the user

1. **The operator CLI approves and withdraws** (`vpr reference …`), where the
   operator key already lives; Pi can only propose. The web UI can come later
   through the gateway.
2. **The flow:** propose (snapshot + unsigned proposal) → approve (sign, verify,
   promote append-only) → verify (every ADR check) → withdraw (signed,
   append-only; the evidence stays).
3. **Where code lives:** verification and receipt building in
   `@studio/contracts`; `proposeReference` in `@studio/episode`; the
   `pva_propose_reference` tool in the agent; `vpr reference approve | withdraw
   | verify | list` in the runtime CLI.

## Design

### Layout

```text
library/<channel>/series/<series>/
  templates/<tid>/references/
    <ref-id>.json                  # promoted SeriesReference: exclusive create, never rewritten
    <ref-id>.withdrawal.json       # signed withdrawal: exclusive create
  episodes/<episode>/
    reviews/references/<ref-id>/
      episode-spec.json            # frozen snapshot (copy of the episode's spec)
      edit-timeline.json           # frozen snapshot (copy of artifacts/edit-timeline.json)
      proposal.json                # the descriptor without `approval`, as proposed
    output/<render-id>.mp4         # immutable render, referenced in place
    output/<render-id>.report.json # its report, referenced in place
```

`layout.mjs` already has `seriesReferencePath`; it gains
`seriesReferenceWithdrawalPath(root, channel, series, templateId, referenceId)`
and `REFERENCE_SNAPSHOT_DIR = "reviews/references"`.

### Contracts — `studio/contracts/src/series-references.mjs` (+ `.d.mts`)

```ts
type ReferenceState = "trusted" | "withdrawn" | "invalid" | "unverifiable";
interface ReferenceVerdict {
  state: ReferenceState;
  reference: SeriesReference | null;   // the parsed descriptor, when readable
  problems: { code: string; message: string; path: string }[]; // empty when trusted
  withdrawal?: GateReview;             // when withdrawn
}
verifySeriesReference({ seriesDir, templateId, referenceId, key }): ReferenceVerdict
buildReferenceApproval({ reference, at? }): GateReview      // unsigned; the caller signs
buildReferenceWithdrawal({ reference, descriptorHash, reason, at? }): GateReview // unsigned
```

`verifySeriesReference` reads files (as `hashArtifacts` does) and applies, in
order, stopping at the first failing step:

1. **Descriptor** — `<ref-id>.json` exists and is JSON (`missing-reference`,
   `bad-reference`); `validateSeriesReference` passes; its `id` equals
   `referenceId`, its `template.id` equals `templateId`, its
   `episodeRef.series` and `.channel` are the series' (`reference-identity`).
2. **Signature** — with no `key`, the state is `unverifiable`. Otherwise
   `verifyReceipt(approval, key)` (`bad-signature`), and the approval is
   `origin: "human"`, `decision: "approved"`, `stageId: "reference-review"`,
   `episode` = `"<channel>/<series>/<episode>"` of the descriptor
   (`not-an-approval`).
3. **Withdrawal** — if `<ref-id>.withdrawal.json` exists: it must verify with
   the key, be human, `decision: "rejected"`, `stageId: "reference-review"`,
   the same `episode`, and bind the descriptor's file hash in
   `binding.inputs` (`[{ path: "<ref-id>.json", sha256 }]`). Valid → state
   `withdrawn` (the verdict carries it; no further checks). Invalid →
   `invalid` with `bad-withdrawal`: a forged withdrawal must not quietly
   disable a reference, nor be ignored.
4. **Files** — the source episode is `episodes/<episode>` of the series. Each
   of `spec`, `timeline`, `render`, `report` must exist (`missing-file`),
   resolve (realpath) inside the source episode (`path-escape`), be a file,
   and hash as declared (`hash-mismatch`).
5. **Frozen spec** — the pinned release must be in the series
   (`missing-release`; never today's version instead); the snapshot passes
   `validateEpisodeSpec` against it (`frozen-spec`); its `episodeRef` and
   `template` equal the descriptor's (`reference-identity`).
6. **Provenance** — the timeline snapshot's `derivedFrom.spec.hash` is the
   spec snapshot's hash, and the report's `timeline.hash` is the timeline
   snapshot's hash (`provenance-mismatch`).

All pass → `trusted`. Problems carry paths relative to the series
(`templates/<tid>/references/<ref-id>.json#$.approval`,
`episodes/<ep>/output/<id>.mp4`).

`buildReferenceApproval` returns the `GateReview` the descriptor carries:
`stageId: "reference-review"`, `decision: "approved"`, `origin: "human"`,
`actor: "human"`, `binding: { planHash: sha256 of the canonical proposal,
inputs: [spec, timeline], outputs: [render, report] }` (paths relative to the
episode, bare hex), `episode` slug, `checks: []`, `note`. It is built through
`buildGateReview`, so its shape is the gates' own.

### Episode — `studio/episode/src/references.ts`

`proposeReference(episodeDir, { episodeRef, referenceId })` →
`{ ok: true, proposal, paths } | { ok: false, problems }`:

- `referenceId` is a slug (`bad-id`); no `reviews/references/<id>/` in the
  episode and no `templates/<tid>/references/<id>.json` in the series
  (`reference-exists`).
- The episode is spec-driven (`no-spec`); `output/current.json` names a render
  whose file and report exist (`no-render`).
- The render's report names the timeline it rendered
  (`report.timeline.hash`): it must equal the hash of
  `artifacts/edit-timeline.json` now (`timeline-changed` — render again or
  restore the timeline).
- `checkEpisode` on that timeline: no error findings (`series-rules`, with the
  findings).
- Copies `episode-spec.json` and `artifacts/edit-timeline.json` into
  `reviews/references/<id>/`, then writes `proposal.json`: a `SeriesReference`
  without `approval` — `id`, `episodeRef`, `template` (the spec's pin), `spec`,
  `timeline`, `render`, `report` (paths relative to the episode, `sha256:`
  hashes), `metadata: { proposedAt }`. The directory is created exclusively:
  a concurrent proposal of the same id fails.

### Agent — `pva_propose_reference { channel, series, episode, referenceId }`

Calls `proposeReference`; replies with the files frozen and the command the
operator runs to approve
(`vpr reference approve <channel>/<series>/<episode> <id>`), and says that only
a person can approve. Nothing in the agent names the operator key (the
`no-operator-key` test).

### Runtime CLI — `vpr reference …` (`studio/runtime/src/cli.ts`)

The key is resolved as `vpr approve` resolves it.

- **`approve <ch>/<series>/<ep> <ref-id> [--note "…"] [--dry-run] [--json]`**:
  reads `proposal.json`; re-hashes every file it names (`proposal-changed`
  when any differs: what is approved is exactly what was proposed); refuses
  when `templates/<tid>/references/<ref-id>.json` exists
  (`reference-exists`); no key → refuses (`no-operator-key`). Builds the
  approval, signs it (`signReceipt`), assembles the descriptor (the proposal
  as it is, `metadata` included, plus `approval`), runs
  `verifySeriesReference` on it **before** writing (from a temporary file in
  the same directory) and refuses on any problem; then appends an
  `approval-granted` event carrying the signed review to the episode's
  journal (the gate records' own event) and creates the descriptor with an
  exclusive create. `--dry-run` prints the descriptor and the verdict and
  writes nothing.
- **`withdraw <ch>/<series> <tid> <ref-id> --reason "…" [--json]`**: reason
  required; key required; the descriptor must exist; no withdrawal yet
  (`already-withdrawn`). Builds the withdrawal (binding the descriptor's
  hash), signs it, appends an `approval-rejected` event to the source
  episode's journal, creates `<ref-id>.withdrawal.json` exclusively.
- **`verify <ch>/<series> <tid> <ref-id> [--json]`**: prints the verdict;
  exit 0 when `trusted`, 1 otherwise.
- **`list <ch>/<series> [--json]`**: every `templates/*/references/*.json`
  (not the withdrawal files) with its state and first problem.

Each command is added to the CLI's command table with its usage and examples,
like `approve`.

### Skill — `skills/studio/propose-reference.md` (0.1.0)

When to propose (an episode the person says is exemplary of the series, its
render approved), how (`pva_propose_reference`), what the person then runs
(`vpr reference approve …`), and never: approve, sign, edit a snapshot or a
descriptor, or propose an episode with series-rule errors.

### Docs

- ADR-0037 "Golden references" gains how the studio does it: propose,
  approve (CLI, signed, verified, append-only), verify (the six steps),
  withdraw (signed, append-only, evidence kept); status line updated.
- `docs/running.md`: the `vpr reference` commands; `pva_propose_reference` in
  the tool list.
- `studio/contracts` README / contract catalog: `series-references.mjs`.

## Testing

- **Contracts** (`node:test`, temporary series built from the contract
  fixture's release and a test key): a valid reference → `trusted`; one test
  per failure code (`missing-reference`, `bad-reference`,
  `reference-identity`, `bad-signature`, `not-an-approval`, `missing-file`,
  `path-escape` by symlink, `hash-mismatch`, `missing-release`,
  `frozen-spec`, `provenance-mismatch`); valid withdrawal → `withdrawn`;
  forged withdrawal → `invalid` / `bad-withdrawal`; no key → `unverifiable`;
  built approval and withdrawal verify after `signReceipt`.
- **Episode** (vitest, `@studio/episode/testing` episode, fake render files and
  report): `proposeReference` freezes the snapshots and writes a proposal with
  matching hashes; refuses `no-spec`, `no-render`, `timeline-changed`,
  `series-rules`, `reference-exists` (proposed and promoted), `bad-id`;
  writes nothing outside `reviews/references/<id>/`.
- **Runtime CLI** (vitest, temporary library, key file): `approve` promotes,
  journals `approval-granted`, and `verify` then says `trusted`; refuses
  `proposal-changed`, `reference-exists` (descriptor byte-identical),
  `no-operator-key`; `--dry-run` writes nothing; `withdraw` writes the signed
  withdrawal, `verify` says `withdrawn`, a second withdrawal is refused;
  `verify` exit codes; `list` shows each state.
- **Agent**: `pva_propose_reference` reply and refusal; tool count 46; the
  `no-operator-key` test still passes; the skill is discovered.
- Root `npm run check`, `npm run docs:build`.

## Out of scope

The web UI for approving references; comparing an episode with a reference
(`avg-jao.5`); choosing which reference a new episode is compared with;
re-pinning a reference to a newer release (a new reference, by design).
