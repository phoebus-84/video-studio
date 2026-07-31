# Semantic TTS segmentation

`qwen_tts_worker.segmentation` converts hard-bounded speaker turns into independently synthesizable `SemanticSegment` artifacts. It uses spoken-word, predicted-duration, and backend-token limits; characters are only a final safety backstop.

## Initial measured policy

Version `0.1.0` ships the following conservative, evaluation-visible policy:

| Role | Preferred minimum | Target | Hard maximum | Target duration | Hard duration |
|---|---:|---:|---:|---:|---:|
| Narration | 25 words | 45 words | 70 words | 18 s | 28 s |
| Dialogue | 8 words | 24 words | 40 words | 10 s | 17 s |

Both roles also use a maximum of 180 estimated backend tokens and 500 characters. Predicted duration uses 2.6 spoken words/second plus deterministic punctuation allowances. These are planning estimates, not claims about generated WAV duration.

The defaults were exercised against the current supported source corpus:

- 87 ingested turns became 151 semantic segments;
- word distribution: minimum 3, median 44, maximum 68;
- predicted duration distribution: 1.23 s, 18.28 s, 27.57 s;
- largest segment: 419 characters and 84 estimated backend tokens;
- boundaries: 60 sentence, 4 clause, and 87 turn-end;
- the 18 reviewed quality-fixture segments remained 18 segments (median 11 words, maximum 31).

These figures establish deterministic operating evidence only. Listening evaluation may revise the policy version.

## Boundaries and safety

Hard boundaries are supplied as separate `SegmentationInput` records for speaker, language, paragraph, or explicit-pause transitions. Within a turn:

1. complete sentence boundaries are preferred;
2. punctuation-delimited completed clauses are allowed when required;
3. arbitrary word-count cuts are forbidden.

A break is rejected inside:

- caller-supplied protected spans;
- normalized replacements discovered by display/spoken alignment;
- URLs, emails, versions, decimals, percentages, and known abbreviations;
- parentheses, brackets, braces, or nested quotation marks.

If no safe sentence/clause boundary exists inside all hard limits, segmentation raises `SegmentationError` for editorial review instead of cutting a noun phrase or protected expression.

## Display/spoken alignment and conservation

Display and spoken text are aligned as ordered token runs. A normalization replacement such as `$12.50` → `twelve dollars and fifty cents` becomes one atomic protected run.

Each segment stores display and spoken content plus the exact separator following each form. Therefore:

```python
"".join(s.spoken_text + s.spoken_separator_after for s in result.segments)
```

exactly reconstructs input spoken text; the equivalent display expression reconstructs input display text. Every source span is narrowed when the input is an exact direct source slice. Escaped or composite inputs retain conservative containing spans with `source_spans_exact=false`.

## Stable IDs

`segment_id` hashes:

- segmentation ID version;
- caller-supplied stable `source_anchor_id`;
- language, role, and speaker;
- exact normalized spoken content;
- occurrence among identical segments under the same anchor.

It intentionally excludes document revision hashes, absolute offsets, neighboring context, and segment ordinal. An unrelated edit can change context metadata without invalidating an unaffected segment ID. Callers must provide an editorial anchor stable across source revisions; a whole-document hash is not a valid anchor.

## Context, pauses, and reporting

Adjacent text is retained as `metadata_only` context and is never prepended to synthesis text. Pause intents are explicit and reason-coded:

- sentence: 220 ms;
- clause: 120 ms;
- same-speaker turn: 220 ms;
- speaker transition: 350 ms;
- caller override: exact requested duration.

These values are mastering inputs, not model-generated silence requirements.

Every segment and report records both the human policy ID and a SHA-256 fingerprint of the complete validated policy. Each result reports segment/turn counts, words, backend tokens, predicted durations, min/median/max distributions, boundary reasons, above-target counts, and hard-limit contacts. Reports must accompany policy tuning and baseline-versus-candidate evaluation.
