# Contract catalog

This catalog assigns every durable wire or workspace concept to one contract family. JSON Schema will be canonical; generated TypeScript and Python bindings are projections of these schemas.

## Families

| Family | Durable kinds and records | Primary producer | Primary consumers | Planned Beads |
|---|---|---|---|---|
| `identity` | Stable IDs, revisions, content hashes, provenance, relative paths, timestamps, money | contracts library | every module | `vwc-5q0.2` |
| `workspace` | Channel, Series, Episode, settings layers, Source Snapshot, Voice Profile, Visual Bible, Current Deliverable pointer | runtime and editors | runtime, gateway, Pi, web | `vwc-5q0.3` |
| `pipeline` | Pipeline, Stage Definition, Pipeline Patch, Provider Binding, Pipeline Snapshot | pipeline authors and runtime | runtime, Pi, gateway, web | `vwc-5q0.4` |
| `editorial-artifact` | Editorial Artifact envelope, brief, adapted story, script, TTS script, Art Direction Pack, Tape file | Pi and editors | runtime, Pi, web, render tools | `vwc-5q0.5`, `vwc-5q0.16` |
| `production-plan` | Scene Plan, Narration Segment, prompt record, Edit Timeline source references | Pi | runtime, adapters, composer, web | `vwc-5q0.5`, `vwc-5q0.6` |
| `asset` | Asset Attempt, Asset Manifest, Selected Asset, VideoAttempt, media probe summary | provider adapters and renderers | runtime, Pi, composer, gateway, web | `vwc-5q0.5`, `vwc-5q0.15` |
| `provider-job` | Capability request, persisted provider job, progress, cancellation, normalized result | provider adapters and TTS worker | Pi, runtime, gateway, web | `vwc-5q0.7` |
| `narration` | Source-mapped Segment, immutable Synthesis Attempt, Signal Quality Report, ordered accepted-attempt Manifest, measured WAV/mastering metadata, caption cues, legacy read sidecar | Pi and TTS worker | runtime, composer, gateway, web | `qtw-48r.6.2` |
| `timeline` | v1alpha2: tracks of versioned kit instances and audio items, ducking, sections with spec provenance, integer frames, its output profile (size, safe zone, loudness) (ADR-0034) | Pi and editors | Remotion composer, runtime, web | `vwc-5q0.6`, `avg-tk7.4` |
| `output-profile` | Output profile catalog (`src/output-profiles.json`): size, safe zone in pixels, loudness target; `youtube-1920x1080`, `vertical-1080x1920` | contracts | series compilers, workspace settings, Remotion composer tests | `avg-tk7.4` |
| `word-timing` | Word Timing per take: words (written and spoken), lines as word ranges, speech spans, energy envelope, audio hash binding, aligner provenance | `speech.align` adapters | series compilers, cue resolver, kits, narration QA | `avg-7zp.1` |
| `cue` | Cue grammar for series specs (word, prefix, seconds, word/line/take/mark objects) and its resolution to frames against a take's Word Timing | series spec authors (Pi, editors) | series compilers | `avg-7zp.2` |
| `narration-takes` | Narration Takes: provider-neutral take registry (text, spoken text as sent, voice provenance, word timing ref, narration-manifest source) and unit sequences with pauses and scene pauses; unit layout; Qwen manifest mapping | TTS provider adapters, Qwen worker via mapping | series compilers, cue resolver, composer | `avg-7zp.4` |
| `source-pin` | Source Pin: shared material an episode reads without copying (channel source or episode), its file inventory and the stages that read it | `vpr pin add`, series compilers | runtime status, `vpr pin renew` | `avg-7zp.5` |
| `event` | Journal Event envelope, correlation and causation, typed lifecycle payloads, cursor | runtime and services | gateway, projections, web, Pi | `vwc-5q0.7` |
| `review` | Review Thread, anchor, reply, resolution, stale anchor, approval decision | users, Pi, gateway | runtime, gateway, web, Pi | `vwc-5q0.7` |
| `policy` | Approval Policy, Budget Envelope, reservation/reconciliation, material downgrade, stale acceptance | channel/series owners and runtime | runtime, Pi, gateway, web, adapters | `vwc-5q0.3`, `vwc-5q0.7` |
| `report` | Stage Attempt, Render Report, delivery QA finding, capability health, structured error | runtime and services | Pi, gateway, web | `vwc-5q0.5`, `vwc-5q0.6`, `vwc-5q0.7` |

## Ownership rules

1. This module owns shape, version, examples, and compatibility. It does not own runtime behavior.
2. A durable concept has one canonical family. Other schemas reference it with `$ref`; they do not copy its fields.
3. Provider names, model endpoint IDs, capability names, MIME types, languages, and user labels are open vocabularies represented as constrained strings, not central enums.
4. Control-flow states, approval modes, journal event types, and discriminators are closed vocabularies. Consumers must not invent values.
5. Human prose remains in Markdown bodies; only its envelope, frontmatter, references, and typed derivatives are contracts.
6. Binary media is not embedded. Contracts use portable workspace-relative paths plus content hashes and provenance.

## Boundary review

The catalog was checked against the root `ARCHITECTURE.md`, `WORKSPACE.md`, `PIPELINES.md`, all accepted ADRs through ADR-0022, and the ten module charters. Command-specific REST routes and visual component state are intentionally excluded: gateway APIs compose these domain contracts instead of becoming new production truth.
