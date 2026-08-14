You are responsible for designing and implementing a local pipeline that produces consistently high-quality TTS audio.

## Objective

Improve the quality, naturalness, pronunciation, pacing, emotional consistency, and speaker continuity of locally generated audio.

Treat text preprocessing as a first-class stage of the TTS pipeline. High-quality speech does not depend only on the model or generation parameters; it also depends on how written text is normalized, adapted for spoken delivery, segmented, and paired with appropriate voice instructions.

## Reference project

Study the following project, paying particular attention to how it prepares text, segments content, orchestrates TTS generation, handles retries, and assembles the final audio:

https://github.com/Finrandojin/alexandria-audiobook/

Use it as a reference, not as a specification.

Do not copy its implementation or architecture mechanically. Identify which ideas are relevant, which assumptions differ from this project, and which approaches should be adapted, replaced, or omitted.

## Available skills

Use the following skills as domain guidance:

1. ./preprocessor.md
2. ./qwen3-voice-director.md

The first skill governs the transformation of written text into TTS-ready spoken text.

The second skill governs how Qwen3-TTS CustomVoice should be instructed while preserving voice identity and delivery consistency across independently generated segments.

Do not treat these skills as unquestionable requirements. Evaluate them critically against the actual model, runtime, repository structure, and quality goals. Improve or extend their recommendations when evidence justifies doing so.

## Required investigation

Before changing the implementation:

1. Inspect the existing repository and map the current end-to-end audio-generation flow.
2. Identify every stage that can affect output quality, including:

   * source-text ingestion;
   * cleanup and normalization;
   * language-specific preprocessing;
   * dialogue and quotation handling;
   * number, date, currency, abbreviation, symbol, and unit expansion;
   * sentence and paragraph segmentation;
   * segment-size limits;
   * speaker selection;
   * CustomVoice instructions;
   * generation parameters and randomness;
   * cross-segment voice and prosody consistency;
   * silence and pause handling;
   * retries and regeneration;
   * audio normalization;
   * concatenation and boundary artifacts;
   * caching and reproducibility;
   * quality validation.
3. Verify the behavior and limitations of the exact Qwen3-TTS implementation used by this project.
4. Compare the current pipeline with the relevant techniques used by Alexandria Audiobook.
5. Separate confirmed facts from assumptions.
6. Identify the highest-impact quality problems before proposing architectural changes.
7. Prefer measurable improvements over speculative complexity.

## Planning requirements

Create an implementation plan before making substantial changes.

The plan must:

* describe the current architecture;
* define the desired pipeline;
* identify gaps between the two;
* divide the work into coherent modules;
* order the work by dependency and expected quality impact;
* define acceptance criteria for every major task;
* include testing and evaluation work;
* include migration or compatibility concerns;
* avoid unnecessary rewrites;
* clearly distinguish required work from optional enhancements.

For every proposed change, explain:

* what problem it solves;
* why it belongs at that stage of the pipeline;
* what evidence supports it;
* what risks or trade-offs it introduces;
* how its effect on audio quality will be evaluated.

Do not begin with a broad rewrite. Start with the smallest architecture that allows reliable testing and iteration.

## Beads DB project tracking

Use the module-level Beads DB to track the entire effort.

Create and maintain:

* one top-level epic for the local high-quality TTS pipeline;
* child epics for major modules or workstreams;
* individual issues for implementation, research, testing, migration, and documentation;
* explicit dependency links between related issues;
* links from every issue to its parent epic or module;
* links between issues that block, depend on, validate, or supersede one another.

Ensure that the full hierarchy and execution route are discoverable from the Beads index.

The index must make it possible to understand:

* the overall goal;
* the module structure;
* the recommended execution order;
* blocking dependencies;
* current status;
* completed decisions;
* unresolved questions;
* the path from research to implementation and validation.

Do not create disconnected issues. Every Beads item must belong to the project hierarchy and participate in the documented execution route.

Update Beads as the work progresses, not only at the beginning or end.

## Target pipeline

Design the solution around explicit, testable stages. A likely structure is:

1. Source-text ingestion
2. Structural analysis
3. Language-aware text normalization
4. Spoken-language adaptation
5. Dialogue and narration analysis
6. TTS-safe segmentation
7. Voice-direction generation
8. Qwen3-TTS CustomVoice synthesis
9. Segment validation and selective regeneration
10. Audio post-processing
11. Concatenation and mastering
12. Quality evaluation and artifact reporting

This structure is provisional. Modify it when repository constraints or investigation results support a better design.

Each stage should have a clear input, output, responsibility, and test boundary.

## Text preprocessing requirements

The preprocessing stage must preserve meaning and factual content while improving spoken delivery.

It should account for:

* punctuation as a prosodic signal;
* written language that sounds unnatural when spoken;
* overly long or syntactically nested sentences;
* ambiguous pronunciations;
* language-specific normalization;
* dialogue attribution;
* quotation boundaries;
* semantic segment boundaries;
* context required for correct pronunciation;
* consistency of names and technical terms;
* the distinction between textual formatting and intended pauses.

Do not use uncontrolled rewriting that changes meaning, omits information, embellishes the source, or makes results difficult to reproduce.

Where an LLM is used, define a strict input/output contract and validation strategy.

## CustomVoice requirements

Maintain a stable speaker identity across segments.

Treat the selected CustomVoice speaker as the source of voice identity. Use instructions primarily to control delivery, such as:

* pacing;
* articulation;
* energy;
* emotional intensity;
* narrative intent;
* dramatic weight;
* conversational distance.

Avoid repeatedly redefining speaker identity through age, gender, pitch, timbre, or accent unless testing demonstrates that the specific implementation requires it.

Keep the base voice instruction stable across related segments. Apply only small, intentional variations when the content genuinely requires a change in delivery.

Investigate how speaker choice, instruction wording, generation parameters, random seeds, segment length, and textual context affect cross-segment consistency.

## Evaluation requirements

Do not judge improvements from a single generated example.

Build a small but representative evaluation set containing:

* neutral narration;
* expressive narration;
* dialogue;
* questions and exclamations;
* long and short sentences;
* names and foreign words;
* numbers, dates, times, currencies, abbreviations, and units;
* punctuation-heavy passages;
* transitions between emotional states;
* consecutive segments that must sound like one continuous performance.

Preserve baseline outputs before modifying the pipeline.

Compare changes using repeatable tests and, where practical:

* blinded listening comparisons;
* pronunciation-error counts;
* continuity checks between adjacent segments;
* clipping and loudness measurements;
* silence-duration analysis;
* regeneration rates;
* deterministic or seeded generation tests;
* processing time and memory usage.

Record both improvements and regressions.

## Execution rules

After the investigation and plan are complete, implement the work in dependency order.

For each module:

1. confirm the relevant Beads issue;
2. implement the smallest complete change;
3. add or update tests;
4. generate representative audio samples;
5. compare them against the baseline;
6. document findings and trade-offs;
7. update the issue status and dependency graph;
8. continue only when the acceptance criteria are met or the remaining limitation is documented.

Do not claim that a change improves quality without evidence from the evaluation set.

Do not hide failures by regenerating until one sample sounds good. Measure reliability across repeated generations.

Avoid introducing abstractions that are not justified by current requirements.

## Expected deliverables

Produce and maintain:

* an analysis of the existing pipeline;
* a comparison with Alexandria Audiobook;
* an architecture proposal;
* a dependency-ordered implementation plan;
* a complete Beads epic and issue hierarchy;
* an indexed execution route;
* implementation changes;
* automated tests where appropriate;
* a representative audio evaluation set;
* baseline and comparison outputs;
* documentation of configuration and model parameters;
* documented findings, limitations, and follow-up opportunities.

## Definition of done

The work is complete when:

* text preprocessing is an explicit, modular, testable pipeline stage;
* language-specific normalization is supported cleanly;
* segmentation follows semantic and spoken-delivery boundaries;
* CustomVoice instructions are generated consistently;
* speaker identity remains acceptably stable across consecutive segments;
* failed or poor segments can be identified and regenerated independently;
* concatenated output avoids obvious boundary artifacts;
* the pipeline can be reproduced locally;
* quality improvements are demonstrated against the recorded baseline;
* all work is represented and linked correctly in Beads DB;
* the Beads index documents the complete route from the top-level epic to implementation and validation;
* remaining limitations are documented honestly.

Begin by inspecting the repository, the exact Qwen3-TTS integration, the two supplied skills, and the Alexandria Audiobook reference. Then create the investigation report, proposed architecture, Beads hierarchy, and dependency-ordered execution plan before implementing substantial changes.
