# English spoken-text normalization

`qwen_tts_worker.normalization` converts a source-mapped `SpokenBlock` into a versioned `NormalizedBlock`. Display text is immutable; synthesized text and every change are separate.

## Policy

- Version/locale: `0.1.0`, `en-US` only.
- Unicode: compatibility normalization is explicit and audited; no lossy decoding.
- Rules are deterministic, ordered, and non-overlapping.
- Episode/project pronunciation lexicon entries have highest priority.
- Every change records rule ID, original text, replacement, block-local span, source span, and whether the source span is exact.
- Ambiguous forms remain unchanged and produce a source-mapped diagnostic instead of being guessed.
- Normalization never performs semantic segmentation or speaker attribution.

## Supported forms

| Category | Example | Spoken form |
|---|---|---|
| Cardinal | `1,234` | `one thousand two hundred thirty-four` |
| Ordinal | `31st` | `thirty-first` |
| Decimal | `12.5` | `twelve point five` |
| Written US date | `July 31, 2026` | `July thirty-first, twenty twenty-six` |
| Twelve-hour time | `9:05 a.m.` | `nine oh five a.m.` |
| US currency | `$1,234.50` | `one thousand two hundred thirty-four dollars and fifty cents` |
| Percentage | `12.5%` | `twelve point five percent` |
| Contextual unit | `48 V` | `forty-eight volts` |
| Compound unit | `5 km sensor` | `five kilometer sensor` |
| Known abbreviation | `Dr.` | `Doctor` |
| Initialism | `TLS` | `T L S` |
| Version | `v0.4.6` | `version zero point four point six` |
| Command option | `--help` | `dash dash help` |
| Symbols | `A & B + C` | `A and B plus C` |
| Inline-code markup | `` `bd show` `` | `bd show` (terms may still require lexicon entries) |

The generic unit list is intentionally narrow: `km`, `kg`, `cm`, `mm`, `Hz`, `kHz`, `MHz`, `V`, `kV`, `GB`, `MB`, `ms`, and `°C`. Ambiguous units such as bare `m` are not guessed.

## Pronunciation lexicon

Lexicons are exact, locale-scoped inputs rather than source rewrites:

```python
PronunciationLexicon(entries=(
    PronunciationEntry(
        entry_id="jaromail",
        display="JaroMail",
        spoken="Jaro Mail",
        language="en-US",
    ),
    PronunciationEntry(
        entry_id="issue-id",
        display="qtw-48r",
        spoken="Q T W forty-eight R",
        language="en-US",
    ),
))
```

Matching is case-insensitive unless `case_sensitive=True`. Conflicting entries are rejected. A lexicon entry may resolve an otherwise ambiguous identifier, name, foreign word, acronym, URL, or email address.

## Review-required forms

The first version preserves and diagnoses:

- numeric dates such as `03/04/2026`;
- impossible calendar dates;
- times without an explicit a.m./p.m. policy;
- non-USD currency and malformed USD precision;
- malformed comma grouping;
- leading-zero numbers;
- slash fractions and numeric ranges;
- ambiguous `St.`;
- URLs, email addresses, and mixed alphanumeric identifiers.

Callers must block publication on `error` diagnostics or obtain a reviewed override. Warnings require review or an explicit policy decision. Unsupported locales raise `NormalizationError` rather than silently applying US English rules.

## Source mapping

For Markdown blocks whose source slice exactly equals display text, each substitution receives an exact document character span. For escaped JSON strings, the block-local span remains exact while `source_span` conservatively references the encoded source field and `source_span_exact=false`. This prevents fabricated offsets while preserving complete source identity.
