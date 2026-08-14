# Stable CustomVoice profiles and delivery direction

`qwen_tts_worker.direction` separates preset identity from bounded performance direction.

## Identity contract

A `CustomVoiceDirectionProfile` pins:

- profile ID and revision;
- editorial character ID and continuity group;
- backend-discovered CustomVoice preset speaker;
- source and backend language;
- base-direction ID and stable base instruction.

Supported speakers and languages are read from the installed checkpoint's `config.json`; they are never inferred from stale constants. Unknown values fail before model generation.

The preset owns identity. Base instructions that attempt to redefine age, gender, voice, timbre, pitch, or accent are rejected. A continuity group cannot change profile revision, preset speaker, or base-direction ID between adjacent segments.

## Delivery deltas

A neutral delta emits the exact base instruction. Non-neutral direction can use only the enumerated `DeliveryDelta` dimensions:

- pace: slower, steady, quicker;
- articulation: soft, natural, crisp;
- energy: low, medium, high;
- emotion: neutral, warm, joyful, curious, somber, tense, urgent;
- intensity: restrained, moderate, strong;
- intent: narrate, explain, reassure, wonder, warn, question, exclaim;
- distance: intimate, conversational, projected.

Each value maps to one reviewed phrase in deterministic schema order. Contradictions with explicit base direction fail rather than being appended. Base instructions are limited to 512 characters and final instructions to 768.

Example:

```text
Speak clearly and naturally while maintaining consistent delivery.
Use a steady pace; Use crisp articulation; Add gentle warmth;
Deliver as narration; Use conversational distance.
```

Direction changes performance only. It does not change speaker, language, normalized text, source identity, seed, or sampling controls.

## Segment planning

`direct_segment()` binds one `SemanticSegment` to one validated profile and produces the module-local `SegmentPlan` contract. Speaker/language mismatches are rejected without aliases or fallback. The plan retains source spans, display/spoken text, preprocessing fingerprint, metadata-only neighboring context, and explicit pause duration.

`evaluation/fixtures/direction-continuity-v1.json` freezes adjacent narrator and character sequences over the representative quality fixture. Candidate evaluation must generate these in order and judge identity drift, pacing, emotional transition, and boundary continuity. Fixture presence is not itself a quality claim.
