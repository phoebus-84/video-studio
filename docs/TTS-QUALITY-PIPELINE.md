# Local high-quality TTS pipeline: investigation and implementation plan

**Status:** investigation and accepted architecture; implementation in progress under `qtw-48r`

**Tracking epic:** `qtw-48r`

**Investigated revisions:** qwen-tts-worker `5957fea64c1a42a8c41aef9bf72266884dc85a81`; Alexandria Audiobook `9ea3fe50178f0241c1068c12eb3a8d7b8abd1737`

**Runtime inspected:** `mlx-audio==0.4.6`, `mlx==0.32.0`, Qwen3-TTS 12 Hz 1.7B CustomVoice MLX 8-bit model converted with mlx-audio 0.3.0

## 1. Scope and evidence rules

This document maps the narration path as observed at revision `5957fea64c1a`, compares it with Alexandria Audiobook, proposes the smallest testable architecture, and defines the dependency-ordered work program. Sections describing “current” behavior are therefore a frozen pre-change baseline, not a claim about the latest worktree. It does not claim an audio-quality improvement. A 54-attempt controlled legacy signal baseline is now preserved under `evaluation/baselines/`; no baseline/candidate blinded listening experiment has been completed.

Implementation status after the frozen investigation:

- `qtw-48r.2` completed: v0.1.0 stage contracts, a nine-case/eighteen-segment evaluation fixture, rubric, and controlled legacy baseline.
- `qtw-48r.4.1` corrected live CustomVoice routing: failures and silence fail closed, the model config owns speaker/language discovery, unsupported profile controls are rejected, and seed/sampling arguments map explicitly to MLX.
- `qtw-48r.4.2` added a serialized warm-model lifecycle with exact checkpoint identity, active leases, failed-load recovery, explicit/idle unload, health state, latency counters, and MLX memory telemetry. A live two-request smoke loaded once and reduced wall time from 7.266 s to 3.242 s.
- `qtw-48r.3.2` added deterministic en-US spoken normalization with exact display/spoken separation, ordered source-mapped changes, episode lexicons, reviewed number/date/time/currency/unit/technical rules, and fail-review diagnostics for ambiguity.
- `qtw-48r.3.3` added conserved narration/dialogue turns, nested quotation handling, explicit alias-based character attribution, stable source spans, and review-required failures instead of speaker guessing.
- `qtw-48r.3.4` added measured word/duration/backend limits, protected display/spoken alignment, safe sentence/clause boundaries, stable content IDs, adjacent metadata context, explicit pause intent, and distribution/reason reports. The supported corpus produces 151 segments from 87 turns with no shipped hard-limit violations.
- Direction policy, durable attempts, mastering, migration, and listening acceptance remain tracked work; no quality win is claimed yet.

Evidence labels used below:

- **Confirmed:** directly observed in repository source, installed dependency source, model metadata, or measured artifacts.
- **Upstream-confirmed:** documented by the official Qwen3-TTS project.
- **Assumption to test:** plausible but not established for this hardware/model/runtime combination.

Two requested guidance files, `./preprocessor.md` and `./qwen3-voice-director.md`, are not present anywhere under `/Users/alcibiade/strange_things`. Their recommendations therefore could not be evaluated. The available `.pi/skills/narration.md` was reviewed as secondary guidance. Missing files are an input gap, not grounds to invent requirements.

## 2. Executive findings

The highest-impact problems are not subtle model tuning issues. They are correctness and observability gaps that make quality results unreliable:

1. **Failures can become successful silent WAVs.** `synthesize_with_qwen()` converts import, file, and runtime failures into silence; the endpoint then reports completion. All 29 WAVs under `qwen-tts-worker/voices/**/output` are silent. This invalidates quality claims and caches bad artifacts.
2. **The documented warm worker is not warm.** Each request passes a model path string to `mlx_audio.tts.generate.generate_audio()`, which loads the model for that call. The lifecycle manager remains an open issue (`qtw-2af.3`).
3. **Preprocessing is effectively absent.** Source scripts are passed directly to synthesis. Of 45 inspected narration-script entries, 16 exceed 500 characters, the median is 459, the maximum is 774, and at least 19 likely mix narration, dialogue, and attribution.
4. **The apparent chunker is dead code.** `/synthesize` computes `chunks = chunk_text(...)` but synthesizes `request.text` once and never uses `chunks`.
5. **Several request controls and modes are misleading.** `language` is never forwarded as `lang_code`; mlx-audio 0.4.6 documents Qwen `speed` as “not directly supported yet”; `use_zero_spk_emb` is accepted through `**kwargs` but unused by the Qwen model; no seed is exposed; and top-k/top-p/repetition penalty cannot be recorded or controlled through this API. `voice_description` does not select a VoiceDesign model—it is passed as an instruction to the same CustomVoice path.
6. **The global “master voice” does not stabilize CustomVoice.** CustomVoice routing ignores reference audio. In Base mode, the process-global first output would instead leak across unrelated voices. It is neither scoped nor a valid CustomVoice continuity mechanism.
7. **No segment-level quality gate exists.** There is no speech-presence check, clipping/loudness/silence validation, transcript verification, retry policy, immutable attempt manifest, or independent rejected-attempt retention.
8. **Assembly is a stream copy, not mastering.** Callers concatenate files with FFmpeg concat and `-c copy`; there is no explicit pause model, trim policy, crossfade, loudness normalization, or boundary analysis.
9. **Metadata and contracts drift.** Sidecars have multiple shapes and several durations differ materially from their WAVs. The public API, settings, actual port, model registry paths, and implementation disagree. The registry reports all models as not installed because it expects `qwen3-tts-<0.6B|1.7B>/<profile>`, while synthesis uses installed directories such as `qwen3-tts-1.7b-customvoice-8bit`.
10. **Existing real episode audio is useful only as an uncontrolled legacy corpus.** The 89 scene-like WAVs measured are 24 kHz mono PCM and mostly non-silent, but their prompts, seeds, model identity, preprocessing, and attempt histories are incomplete. They cannot establish causal improvement.

**Recommended first implementation slice:** fail closed on synthesis errors, define a versioned segment-plan artifact, add deterministic English normalization plus semantic segmentation, add stable delivery direction, then produce immutable attempts with basic signal validation. Do not begin with voice cloning, LoRA, broad LLM rewriting, neural MOS, or a large orchestration rewrite.

## 3. Current end-to-end architecture

### 3.1 Control and artifact flow

```text
source/adaptation or repository analysis
  -> Pi write-script / ad hoc episode generation
  -> script.md and/or narration-script.json
  -> Pi tool or generate_narration.py
  -> POST /synthesize {text, voice, speed, instruct, ...}
  -> synchronous FastAPI route
  -> choose relative model directory from presence of instruct
  -> mlx_audio.generate_audio(model=<path string>)
  -> one WAV under voices/<requested-name>/output/
  -> caller copies WAV to library/.../artifacts/narration/<scene>.wav
  -> optional, inconsistent JSON sidecar
  -> FFmpeg concat demuxer with stream copy
  -> narration-full.wav
  -> captions/timing estimate WAV duration
  -> FFmpeg video composition and delivery QA
```

The intended architecture in `ARCHITECTURE.md` and ADR 0008 is stronger: a persistent worker with a warm model, queued segment jobs, cancellation, canonical metadata, immutable attempts, and deterministic runtime integration. Most of that remains planned rather than implemented.

### 3.2 Stage-by-stage map

| Quality stage | Current behavior | Evidence and consequence |
|---|---|---|
| Source ingestion | Episode-specific skills and artifacts; no owned TTS ingestion contract | `write-script.md`, `fairy-tale-ingest.md`, `library/**/artifacts/*`; Markdown scene directions and spoken words are not cleanly separated by a canonical parser. |
| Cleanup/normalization | Pydantic trims only for emptiness; original string otherwise passes through | No Unicode normalization, whitespace policy, mojibake repair, markup removal, or source mapping in the worker. |
| Language preprocessing | Request has `language="auto"`, but it is not passed to mlx-audio | Installed Qwen supports auto plus ten named languages. Official evaluation generally sets a known language explicitly except designated auto tests. |
| Number/date/unit expansion | None | Technical scripts contain forms such as `2019`, `mSMTP`, `GnuPG`, `Dyne.org`, and `SSH` with no pronunciation policy. |
| Dialogue analysis | Mostly manual/ad hoc | Narration scripts often embed dialogue and attribution in one scene and assign one scene-level voice. The narration skill recommends split-and-concatenate but no implementation owns the split. |
| Segmentation | Scene-level caller segmentation; unused character chunker in worker | 45 inspected entries: median 459 chars, max 774, 16 over 500. `chunk_text()` is not applied. Segment IDs do not identify semantic subsegments. |
| Speaker selection | Caller string; instruct switches model; unknown CustomVoice names map silently to Serena | Silent remapping hides configuration errors and can collapse distinct characters to one voice. |
| Voice direction | Free-form `instruct`; episode prompts sometimes redefine age/gender/pitch/timbre | Base direction is not versioned. Prompt wording varies substantially; no delivery taxonomy or bounded override exists. |
| Model selection | No instruct: 0.6B 4-bit Base-like path. With instruct: 1.7B CustomVoice 8-bit if directory exists | Quality silently depends on whether instruct is non-empty. `QTW_MODEL_PATH` can override all routing without metadata proving the actual profile. |
| Generation parameters | Temperature 0.7 is forwarded; Qwen defaults otherwise; no seed | Model checkpoint generation config defaults to temperature 0.9, top-k 50, top-p 1.0, repetition penalty 1.05. Worker overrides only temperature. Reproducibility is absent. |
| Cross-segment continuity | Preset speaker plus free-form instructions; process-global “master” hack | CustomVoice ignores ref audio in mlx-audio routing. First-output master is ineffective for CustomVoice and unsafe for Base multi-speaker use. |
| Retry/regeneration | Tool/pipeline may retry whole stage; worker performs no quality retry | A failed model call may be reported as completed silence. No reason-coded selective regeneration. |
| Audio normalization | None in worker | Existing library scene RMS and peak vary; no target loudness or true-peak policy is attached to segment metadata. |
| Silence/pause handling | Model-generated edge silence; direct concat; some hand-created `silence.wav` | No explicit pause intent or speaker-transition policy. Existing segment leading silence ranges up to 0.814 s in measured corpus. |
| Concatenation | FFmpeg concat demuxer with `-c copy` | No boundary trim, de-click, crossfade, room-tone policy, or mastering pass. Ordering relies on lexical filename sort. |
| Cache/idempotency | Text-only 16-char hash is returned but not used to look up work | Hash excludes voice, instruction, model, language, runtime, and sampling. Every request creates a UUID and output. |
| Validation | WAV header/duration read; downstream checks presence/duration | No minimum amplitude, clipping, NaN, loudness, speech rate, silence, ASR, pronunciation, or continuity check. |
| Quality reporting | Video QA checks broad media properties | There is no TTS-specific report with attempts, metrics, evaluator decisions, or baseline comparison. |

### 3.3 Exact installed Qwen/MLX behavior

Confirmed from `mlx-audio==0.4.6` source and the local model:

- The local model is `Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit`, with nine preset speaker IDs: Serena, Vivian, Uncle_Fu, Ryan, Aiden, Ono_Anna, Sohee, Eric, and Dylan.
- CustomVoice identity comes from the preset speaker embedding. `instruct` is prepended as text conditioning and is intended for emotion/style control.
- Official Qwen guidance recommends each preset's native language for best quality, though every preset can speak supported languages. Ryan and Aiden are native English presets; Serena and Vivian are native Chinese presets.
- Known languages should be passed explicitly when known. The worker currently drops the request language.
- The installed MLX Qwen implementation says `speed` is not directly supported. Passing a value does not implement the API's advertised speech-rate multiplier.
- Generation is stochastic: temperature, top-k, top-p, and repetition penalty affect sampling. MLX exposes `mx.random.seed`, but the worker neither accepts nor applies a seed.
- `voice_description` is not a working VoiceDesign mode in this worker. It only causes CustomVoice selection and is forwarded in the `instruct` field.
- `generate_audio()` loads a model whenever `model` is a string. The worker passes a string each call, so it does not retain a warm model object.
- `generate_audio()` catches exceptions internally and prints them rather than reliably rethrowing. The worker must verify output and fail closed.
- CustomVoice routing does not use `ref_audio`/`ref_text`; reference cloning is a Base-model operation. A CustomVoice continuity design should therefore stabilize preset, language, base delivery instruction, sampling profile, and segmentation—not inject a clone reference.
- The model's default `max_tokens` through the generic helper is 1200, while the local checkpoint allows longer generation. This needs an explicit, measured segment limit rather than a character guess.
- The local model card says it was converted with mlx-audio 0.3.0, while runtime is 0.4.6. Compatibility appears sufficient to load in prior runs but must be pinned and tested.

Unverified assumptions requiring experiments:

- The best temperature/seed strategy for naturalness versus continuity on MLX 8-bit.
- Whether Ryan or Aiden outperforms Serena for this project's English narration style.
- Optimal spoken-word or token limits for artifact rate, continuity, and memory on the local Apple Silicon host.
- Whether micro-crossfades improve boundaries or damage plosives and intentional pauses.
- Whether explicit pacing instructions outperform post-hoc time stretching; speed must not be presented as working until verified.
- Whether adjacent textual context improves starts/ends without causing omitted or repeated words.

### 3.4 Baseline artifact observations

A non-destructive signal scan found:

- 29 worker output WAVs: all 24 kHz, mono, 16-bit, and all digitally silent. These are test/fallback artifacts, not acceptable baseline speech.
- 89 library scene-like WAVs: all 24 kHz, mono, 16-bit; one intentional silence file; median duration 30.0 s; median peak 0.419 full scale; median RMS 0.050 full scale; no sample-level clipping detected by this basic scan.
- 5 `narration-full.wav` files: 105.36–309.89 s, with varying peak/RMS and no recorded mastering provenance.
- 55 sidecars with duration fields; multiple sidecars disagree materially with the actual WAV, and schemas vary (`id`, `scene`, `voice`, `speakers`).

These observations identify integrity gaps. They are not listening-test results and do not demonstrate naturalness, pronunciation, or continuity.

## 4. Alexandria Audiobook comparison

Reference revision: `9ea3fe50178f0241c1068c12eb3a8d7b8abd1737`.

| Alexandria technique | Relevance here | Decision |
|---|---|---|
| LLM converts source to `{speaker,text,instruct}` entries with previous-tail context | Useful for dialogue-heavy public-domain sources, but this project also has authored explainer scripts and needs deterministic transforms | **Adapt:** use optional constrained structural analysis after deterministic cleanup; preserve source spans and validate content conservation. Do not require an LLM for ordinary narration. |
| Second LLM review fixes attribution/dialogue and checks approximate text loss | Good recognition that segmentation needs review; word-count ratio alone does not preserve facts or wording | **Adapt and strengthen:** schema validation, source-span coverage, normalized token/order checks, explicit change log, deterministic fallback. Human review for ambiguous attribution. |
| Smart chunking and merge of consecutive narrator lines | Directly relevant to reducing choppy delivery | **Adapt:** semantic segmenter with min/target/max spoken-length policy, protected abbreviations, dialogue boundaries, and stable IDs. Do not use only character counts. |
| Stable per-speaker voice config and optional seed | Directly relevant | **Adopt conceptually:** immutable voice profile + stable base delivery instruction + recorded seed/sampling profile. Verify MLX seed semantics first. |
| Preset, clone, VoiceDesign, LoRA modes | Broader than current MVP and expensive in model memory | **Defer:** make CustomVoice excellent first. Keep typed extension points; do not load three models or add LoRA now. |
| Cached clone prompts | Relevant only to Base cloning | **Omit from required path:** CustomVoice preset identity is current target. Revisit under optional clone-voice epic. |
| Batch generation grouped by similar text length | Throughput optimization, not first-order quality | **Optional later:** immutable per-segment outputs and deterministic seeds must survive reordering before batching is introduced. |
| Per-segment editor and selective regeneration | Highly relevant | **Adopt:** attempt-addressable artifacts, reason-coded rejection, and one-segment rerun without touching accepted neighbors. |
| Configurable pause for same/different speakers plus per-chunk override | Useful explicit timing model | **Adapt:** pause intent belongs in the segment plan; mastering realizes it after edge-silence analysis. Fixed 250/500 ms defaults need listening evaluation. |
| Concatenation with pydub | Does not itself solve loudness or boundary artifacts | **Replace:** FFmpeg/PCM mastering with format validation, edge policy, optional measured micro-fade, loudness/peak policy, and a boundary report. |
| Warmup and model caches | Relevant to latency and consistent execution environment | **Adopt through existing lifecycle issue:** load a validated model object once and report exact model/runtime identity. |
| VoiceDesign-to-clone persona generation | Could improve custom cast continuity but introduces multiple models and generated identity references | **Optional:** not needed for the one-primary-narrator MVP. |
| UI previews and manual chunk regeneration | Valuable evaluation workflow | **Integrate later:** first expose artifacts and reports through existing runtime/tool contracts; avoid coupling quality logic to a new UI. |

Alexandria is optimized for full books, CUDA/ROCm throughput, large casts, and direct PyTorch Qwen APIs. This project targets 3–8 minute videos, Apple Silicon MLX, one primary narrator plus occasional characters, deterministic pipeline state, and cross-module contracts. Its batching, LoRA, and multi-model assumptions should not be copied mechanically.

## 5. Desired architecture

### 5.1 Boundary decision

Keep **editorial source ownership and episode orchestration in the TypeScript control plane**, while the Python worker owns **TTS-specific deterministic preprocessing, synthesis execution, segment signal validation, and canonical WAV attempt metadata**.

The first vertical slice may expose the new plan through the worker API while preserving `POST /synthesize` as a compatibility adapter. Final mix/master can remain an FFmpeg composer responsibility, but its input must be a typed narration assembly manifest produced from accepted segment attempts.

### 5.2 Explicit stages and artifacts

```text
1 Source ingestion
  SourceDocument {text, format, language, revision}
2 Structural analysis
  SpokenBlock[] {source spans, role, speaker, pause intent}
3 Deterministic language normalization
  NormalizedBlock[] + ChangeLog[] + PronunciationLexicon
4 Optional spoken-language adaptation
  AdaptedBlock[] + validated source mapping
5 Dialogue/narration resolution
  SpeechTurn[] {speaker profile, attribution handling}
6 Semantic segmentation
  SegmentPlan[] {stable id, source spans, display text, spoken text, context}
7 Voice direction
  DirectedSegment[] {stable base direction, bounded delivery delta}
8 CustomVoice synthesis
  SynthesisAttempt {full fingerprint, seed, model/runtime, raw WAV}
9 Validation/selective regeneration
  SegmentQualityReport + accepted attempt reference
10 Audio post-processing
  MasteredSegment + transform metrics
11 Assembly/mastering
  NarrationManifest + narration-full.wav + boundary/loudness report
12 Evaluation/reporting
  RunReport linking fixtures, attempts, metrics, listening judgments, regressions
```

Each stage is a pure transformation where practical. No stage overwrites its input. Every changed spoken token must have an auditable reason and source mapping.

### 5.3 Core data contracts

Minimum versioned entities:

- **SourceDocument:** content hash, language, format, source revision.
- **PronunciationLexicon:** scoped entries for names, abbreviations, symbols, and ambiguous terms; display form separate from spoken form.
- **SegmentPlan:** stable segment ID; source block/span IDs; display and spoken text; language; role/speaker; preceding/following context; intended pause; base and local direction IDs.
- **SynthesisProfile:** exact model path/revision/hash, mlx-audio version, speaker, language, temperature/top-k/top-p/repetition penalty, max tokens, seed policy, and supported controls.
- **SynthesisAttempt:** immutable request fingerprint, timestamps, raw output hash, measured format/duration, status, and failure reason.
- **QualityReport:** signal checks, expected-rate bounds, optional transcript/pronunciation checks, boundary metrics, and accept/reject decision.
- **NarrationManifest:** ordered accepted attempt IDs, pauses/transforms, final output hash, loudness and peak measurements.

The cache key must hash all content-affecting inputs—not text alone. At minimum: normalized spoken text, context policy, voice profile, direction, language, model identity, runtime version, sampling parameters, seed, and preprocessing version.

### 5.4 Text preprocessing policy

Required deterministic first layer:

1. Decode UTF-8 and normalize line endings.
2. Apply Unicode NFC by default; preserve an exact original source.
3. Remove or interpret known script markup without passing stage directions to TTS.
4. Normalize whitespace while preserving paragraph and dialogue boundaries.
5. Protect URLs, emails, semantic version numbers, initials, decimals, abbreviations, and ellipses before sentence splitting.
6. Expand supported categories with locale-aware rules: numbers, ordinals, dates, times, currency, common units, and a small explicit abbreviation table.
7. Apply a project/episode pronunciation lexicon for names and technical terms.
8. Record every substitution as `{source_span, original, spoken, rule_id}`.
9. Reject ambiguity rather than guessing where meaning can change (for example `1/2`, `5'10"`, ambiguous dates, or `read`).

Optional constrained LLM adaptation comes after deterministic normalization and before final segmentation. Its contract must return structured edits tied to source spans. Validation must prove no source span was lost, duplicated, reordered without permission, or supplemented with unsupported content. It is optional because reproducible mechanical normalization covers many high-value cases.

### 5.5 Semantic segmentation policy

Segment by speech turns and semantic/prosodic boundaries, not a fixed 500-character window:

- Hard boundaries: speaker change, paragraph/section break, explicit pause, language change.
- Preferred boundaries: sentence end, completed clause, attribution transition.
- Avoid boundaries inside protected tokens, quotations, parentheticals, noun phrases, or short tightly connected sentences.
- Use a target **spoken token/word and predicted-duration range**, with character count only as a safety backstop.
- Keep enough neighboring text as non-spoken context in the artifact; do not prepend it to synthesis until experiments prove the backend can avoid speaking/repeating it.
- Stable IDs derive from source span identity and normalized spoken content so unrelated edits do not invalidate every segment.

Initial limits must be selected from the evaluation corpus. A reasonable experiment grid is roughly 15–35 spoken words for dialogue and 25–70 for narration, with hard backend token limits. These are hypotheses, not defaults to ship without measurement.

### 5.6 CustomVoice direction policy

For each voice/series:

- Pick a supported preset explicitly; reject unknown names.
- Store a stable base delivery instruction. Do not repeatedly redefine age, gender, timbre, pitch, or accent when using a preset—the preset is voice identity.
- Derive a small per-segment delta from a bounded vocabulary such as pace, articulation, energy, emotional intensity, narrative intent, and conversational distance.
- Permit zero delta. Neutral text should not receive creative variation merely to fill a field.
- Resolve contradictions and cap prompt length. Log the composed instruction and its version.
- Keep speaker, language, base instruction, and sampling profile stable across a continuity group.
- Evaluate intentional transitions over adjacent segments; do not infer continuity from one isolated clip.

### 5.7 Synthesis and retry policy

- Load and retain the exact model object through the lifecycle manager.
- Validate model profile, speaker, language, and supported controls before queuing.
- Fail closed. A silent or missing output is an error, never a successful fallback outside an explicitly selected fake test provider.
- Record a seed and all sampling values. If deterministic replay is not guaranteed by MLX, report that honestly and measure output variance.
- Produce one immutable raw attempt per semantic segment.
- Apply bounded selective retries only for reason-coded failures. Retry seeds/parameters follow a declared policy; accepted attempts are never silently replaced.
- Do not “retry until it sounds good.” Evaluation records attempt count and regeneration rate over repeated runs.

### 5.8 Validation and mastering policy

Required cheap checks before subjective review:

- valid decodable PCM WAV and expected sample format;
- finite samples, non-silent speech presence, duration bounds, peak/clipping, DC offset;
- leading/trailing silence measurements;
- speaking-rate plausibility based on spoken token count;
- output and metadata hashes.

Next-level checks after the foundation:

- local ASR comparison for omission/repetition/substitution detection;
- lexicon-target pronunciation review (automated where confidence is useful, human otherwise);
- adjacent-segment speaker embedding similarity as a diagnostic, not an automatic truth;
- boundary energy/pitch/silence discontinuity report.

Mastering should operate on accepted copies, retain raw WAVs, and record every transform. Use measured trimming with conservative margins, explicit pauses, optional tiny fades only when needed to prevent clicks, resampling/channel normalization, and one final loudness/true-peak pass. Do not normalize each segment independently in a way that pumps room noise or changes perceived performance.

## 6. Evaluation design

### 6.1 Representative fixture set

Create versioned fixtures covering at least:

1. neutral warm narration;
2. expressive narration with a controlled emotional arc;
3. alternating dialogue plus narrator attributions;
4. questions, exclamations, ellipses, em/en dashes, parentheses, and quotations;
5. short fragments and long nested sentences;
6. project names and foreign words;
7. cardinal/ordinal numbers, decimals, fractions, dates, times, currency, percentages, abbreviations, symbols, and units;
8. punctuation-heavy technical narration with URLs, versions, CLI flags, and code identifiers;
9. three or more consecutive segments intended as one performance;
10. an intentional emotion transition across consecutive segments.

Keep exact source text, expected normalized text where deterministic, expected segmentation constraints, pronunciation notes, and a listening rubric. Use both children's storytelling and technical explainer material from this product's actual domain.

### 6.2 Baseline protocol

Before behavior changes:

- Freeze the worker/model/runtime revision and all request inputs.
- Generate at least three repetitions per fixture where stochastic generation is enabled.
- Preserve raw WAV, request/response, environment/model manifest, timing/memory, and signal report.
- Mark the existing library corpus as `legacy-uncontrolled`; do not relabel it as a controlled baseline.
- If the current endpoint emits silence or cannot run, record a failed baseline honestly. Never substitute a hand-picked prior output.

### 6.3 Candidate comparison

Use randomized A/B file names and a rubric for:

- intelligibility and factual/text fidelity;
- pronunciation errors by category;
- naturalness and pacing;
- emotional appropriateness without overacting;
- same-speaker identity/prosody continuity;
- boundary artifacts;
- overall preference.

Report listener count and agreement. Also report objective checks: clipping, integrated loudness and true peak, silence distributions, duration/speaking rate, regeneration rate, deterministic replay hashes or variance, wall time, and peak memory. A quality claim requires aggregate evidence across the set, not one sample.

## 7. Dependency-ordered implementation plan

The Beads epic `qtw-48r` is the source of truth for status and dependencies. The phases below describe the same execution route.

### Phase 0 — Evidence, contracts, and baseline (required)

1. Complete this investigation and resolve missing guidance files.
2. Freeze versioned segment, attempt, quality-report, and narration-manifest contracts.
3. Build the representative evaluation fixtures and scoring protocol.
4. Make legacy synthesis fail closed enough to capture an honest controlled baseline; preserve any failed-baseline evidence.

**Exit criteria:** facts/assumptions are separated; fixtures are immutable; every baseline output has complete provenance; silence cannot pass as speech.

### Phase 1 — Deterministic spoken-text preparation (required)

1. Implement source ingestion and structural block parsing for supported episode artifacts.
2. Implement English normalization and the pronunciation lexicon with source-mapped change logs.
3. Implement dialogue/narrator turn resolution without changing the current one-narrator path.
4. Implement semantic segmentation and stable IDs.
5. Add golden/unit/property tests, including content conservation and ambiguous-input rejection.

**Exit criteria:** all deterministic fixtures normalize and segment reproducibly; no text is lost or silently invented; each output maps to source spans; unsupported ambiguity is actionable.

### Phase 2 — Voice direction and synthesis execution (required)

1. Complete warm model lifecycle and exact model-profile discovery.
2. Implement validated CustomVoice profiles and stable base/delta direction composition.
3. Expose only backend-supported controls; add language and seed/sampling metadata.
4. Implement immutable per-segment jobs, complete fingerprints, cache lookup, cancellation, and bounded retries.
5. Preserve `/synthesize` as a compatibility adapter during migration.

**Exit criteria:** repeated calls do not reload the same model; unknown speakers fail; every attempt identifies all content-affecting inputs; selective rerun touches one segment; fake mode is explicit.

### Phase 3 — Validation, post-processing, and assembly (required)

1. Add signal-level segment validation and reason-coded rejection.
2. Add optional ASR/continuity diagnostics behind measured thresholds.
3. Implement conservative edge processing and explicit pause realization.
4. Assemble accepted segments through a manifest and run final loudness/true-peak mastering.
5. Add boundary, duration, and integrity reports.

**Exit criteria:** silence/clipping/invalid duration cannot pass; raw attempts remain available; final ordering and pauses are manifest-driven; no obvious clicks or duplicated/truncated boundaries in the evaluation set.

### Phase 4 — Evaluation, migration, and product integration (required)

1. Run repeated candidate generations and blinded comparisons against baseline.
2. Record improvements and regressions; tune only with aggregate evidence.
3. Update Pi capability tooling, workspace contracts, pipeline manifests, captions/timing consumers, and sidecars.
4. Document configuration, runtime/model pins, resource costs, operator diagnostics, and limitations.
5. Add one end-to-end fairy-tale and one technical-explainer acceptance run.

**Exit criteria:** acceptance thresholds are met or limitations are explicit; compatibility adapter has a deprecation path; all consumers use canonical metadata; quality reports are reproducible locally.

### Optional enhancements (not on the initial critical path)

- constrained LLM spoken-language adaptation;
- Base-model voice cloning or VoiceDesign-to-clone characters;
- native MLX batching after deterministic per-segment behavior is proven;
- learned MOS, pronunciation, or speaker-similarity models;
- UI A/B review and waveform editor;
- LoRA voices and multilingual normalization beyond the first supported locale;
- music/room-tone mixing.

## 8. Change rationale, risk, and evaluation matrix

| Proposed change | Problem solved / why at this stage | Evidence | Main risk/trade-off | Evaluation |
|---|---|---|---|---|
| Fail-closed synthesis | Prevents fake success before any quality work | 29 worker WAVs are silent; exception fallback returns silence | CI needs an explicit fake provider | Error-path tests; speech-presence gate; zero silent successful live outputs |
| Versioned source/segment artifacts | Makes transforms testable and retries addressable | Current scene JSON and sidecars vary | Contract migration cost | Schema tests; source-span coverage; compatibility fixtures |
| Deterministic normalization | Fixes predictable pronunciation before model tuning | No current expansion or lexicon | Locale rules can misread ambiguity | Golden examples; ambiguity rejection; pronunciation error counts |
| Optional constrained LLM adaptation | Can improve written-to-spoken phrasing after mechanical cleanup | Alexandria uses LLM annotation/review | Meaning drift and non-reproducibility | Source coverage/order validation; human factual review; A/B listening |
| Semantic segmentation | Reduces long/choppy calls and enables selective retry | Current max 774 chars; dead chunker | Too-short segments can harm continuity | Grid test by length; errors, continuity score, runtime, retries |
| Stable CustomVoice direction | Separates identity from delivery and reduces prompt drift | Preset speaker is actual identity conditioning | Under-direction may flatten emotion | Adjacent-segment blinded continuity and expressiveness ratings |
| Explicit language | Uses backend as documented | Request currently dropped; upstream recommends known language | Wrong language can worsen output | Pronunciation/WER comparison auto vs explicit per fixture |
| Seed/sampling manifest | Enables repeatability and reliability measurement | Generation is stochastic and unrecorded | Fixed seed may lock in a poor sample | Repeat hashes/variance; quality distribution over seeds |
| Warm model lifecycle | Reduces repeated loads and stabilizes execution environment | String model loads each call | Memory pressure and lifecycle complexity | Load count, latency, memory, failed-load recovery tests |
| Immutable attempts/cache | Supports selective regeneration and audit | Text hash is unused and incomplete | Disk growth | Cache-hit correctness; invalidation matrix; retention policy |
| Signal/ASR validation | Catches objective failures before listening | Current checks only header/duration | False rejects; ASR accent bias | Labeled good/bad corpus; precision/recall; manual override logging |
| Explicit pauses and conservative edge processing | Removes arbitrary model/concat gaps and clicks | Direct stream-copy concat; ad hoc silence files | Trimming/fades can clip phonemes | Boundary listening; edge-silence and discontinuity metrics |
| Final loudness/peak mastering | Produces consistent delivery level | Existing RMS/peaks vary; composer only measures | Over-normalization can raise noise | EBU R128/true peak; blinded loudness-matched listening |
| Controlled evaluation harness | Prevents anecdotal quality claims | No representative repeated baseline exists | Hardware time and listener effort | Complete run manifests; blinded aggregate results; regressions retained |

## 9. Compatibility and migration

- Keep `POST /synthesize` during the first migration, but make it call the new single-segment path and return canonical attempt metadata. Reject unsupported fields instead of pretending they work.
- Continue writing 24 kHz mono PCM WAV initially, because existing timing/composition assumes it. Any change requires an explicit contract version.
- Add a canonical sidecar while readers temporarily accept legacy sidecars. Never rewrite historical WAVs in place.
- Preserve scene IDs at the episode boundary while introducing semantic child IDs such as `s4.<stable-suffix>`.
- Captions and timing must consume the narration manifest rather than infer order from filenames.
- The final mastering implementation may live in `ffmpeg-video-composer`; ownership must be explicit and the worker must not duplicate final mix policy.
- Cross-module schema changes belong in `video-workspace-contracts`; module-local experimental schemas must not silently become public contracts.
- Existing open beads (`qtw-2af.3`, `qtw-2af.6`, `qtw-i7t.3`) overlap lifecycle, CustomVoice, and fake/fallback safety. The quality hierarchy links to them rather than pretending they do not exist.

## 10. Open decisions

1. Obtain or explicitly waive the missing `preprocessor.md` and `qwen3-voice-director.md` inputs.
2. Confirm the initial normalization locale(s). English-first is recommended because most current scripts and two native-English presets are available.
3. Choose the primary English narrator by blinded evaluation (likely Ryan/Aiden versus the existing Serena convention), not by table description alone.
4. Decide whether final mastering ownership is wholly in `ffmpeg-video-composer` or exposed through a dedicated narration assembly API there.
5. Select baseline hardware/run budget and human listener panel.
6. Define retention limits for raw/rejected attempts and evaluation audio.
7. Decide whether local ASR is required for the first acceptance gate or introduced after signal validation.

## 11. Definition of done mapping

The top-level epic closes only when preprocessing is explicit and testable; locale normalization and semantic segmentation are versioned; CustomVoice directions are stable; accepted consecutive segments meet continuity criteria; failed segments are independently identifiable and rerunnable; assembly has no obvious evaluated boundary artifacts; model/runtime/configuration are reproducible; baseline/candidate evidence demonstrates aggregate quality change; and all limitations plus the connected execution route remain discoverable through Beads and this document.
