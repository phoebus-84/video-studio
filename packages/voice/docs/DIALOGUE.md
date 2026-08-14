# Narration, dialogue, and attribution turns

`qwen_tts_worker.dialogue` partitions each source-mapped `SpokenBlock` into deterministic `SpeechTurn` records before semantic segmentation or synthesis.

## Policy

- Version: `0.1.0`.
- Straight double quotes and typographic nested quotes (`“…”`, `‘…’`) are structural delimiters and are not spoken.
- Text outside quotation marks—including `Mira said` or `she asked softly`—remains in the narrator voice.
- Explicit character labels from ingestion retain their reviewed speaker profile.
- Quoted speech is assigned only when an adjacent attribution contains a configured character alias and an attribution verb.
- Pronouns, narrative proximity, gender, and a one-character cast are **not** treated as sufficient evidence.
- Unresolved or multiply matched speech uses `speaker_profile_id="review-required"` and emits an error diagnostic. It never silently falls back to the narrator.
- Malformed quotation structure is not partially interpreted.

## Speaker directory

Aliases are reviewed configuration, separate from source text:

```python
SpeakerDirectory(speakers=(
    SpeakerEntry(profile_id="mira", aliases=("Mira",)),
    SpeakerEntry(
        profile_id="mother-goat",
        aliases=("Mother Goat", "Mama"),
    ),
))
```

Aliases are case-insensitive and cannot map to multiple profiles. Supported attribution verbs include `said`, `asked`, `whispered`, `replied`, `shouted`, `murmured`, `answered`, and other deliberately enumerated forms.

## Example

Source:

```text
“Is anyone there?” Mira asked. “I brought the lantern!”
```

Turns:

| Role | Speaker | Display/spoken text |
|---|---|---|
| dialogue | `mira` | `Is anyone there?` |
| narrator | `narrator` | `Mira asked.` |
| dialogue | `mira` | `I brought the lantern!` |

Nested quotation depth is retained. In `Mira said, “I heard Tom shout, ‘Run!’”`, the framing text is narrator, the outer utterance is Mira, and `Run!` is Tom when both aliases are configured.

## Conservation and source mapping

Every character in block display text belongs to exactly one speech turn or one structural token. Structural tokens record quote marks and separator whitespace, allowing exact content/order conservation without asking TTS to vocalize markup.

Each turn and diagnostic records:

- stable source block and document identity;
- block-local span;
- source-document span;
- whether that source span is exact;
- deterministic turn ID, role, speaker profile, and quote depth.

Direct Markdown slices receive exact source offsets. Escaped JSON strings retain exact block-local offsets and conservatively reference the containing encoded source field with `source_span_exact=false`.

Publication must stop on dialogue error diagnostics until attribution or speaker configuration is reviewed.
