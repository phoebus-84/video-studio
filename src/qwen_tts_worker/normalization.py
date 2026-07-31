"""Conservative, source-mapped English spoken-text normalization."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Literal

from pydantic import Field, model_validator

from qwen_tts_worker.ingestion import IngestionResult
from qwen_tts_worker.models.quality import (
    FrozenContract,
    PronunciationEntry,
    SourceDocument,
    SourceSpan,
    SpokenBlock,
)


NORMALIZATION_VERSION = "0.1.0"

_ONES = (
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
)
_TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
_ORDINAL_SMALL = {
    0: "zeroth", 1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth",
    6: "sixth", 7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth",
    11: "eleventh", 12: "twelfth", 13: "thirteenth", 14: "fourteenth",
    15: "fifteenth", 16: "sixteenth", 17: "seventeenth", 18: "eighteenth",
    19: "nineteenth", 20: "twentieth", 30: "thirtieth", 40: "fortieth",
    50: "fiftieth", 60: "sixtieth", 70: "seventieth", 80: "eightieth",
    90: "ninetieth",
}
_MONTHS = {
    name.lower(): name for name in (
        "January", "February", "March", "April", "May", "June", "July", "August",
        "September", "October", "November", "December",
    )
}
_MONTH_NUMBERS = {name.lower(): index for index, name in enumerate(_MONTHS.values(), 1)}
_ABBREVIATIONS = {
    "dr.": "Doctor", "mr.": "Mister", "mrs.": "Missus", "ms.": "Ms",
    "prof.": "Professor", "dept.": "department", "approx.": "approximately",
}
_UNITS = {
    "km": ("kilometer", "kilometers"), "kg": ("kilogram", "kilograms"),
    "cm": ("centimeter", "centimeters"), "mm": ("millimeter", "millimeters"),
    "hz": ("hertz", "hertz"), "khz": ("kilohertz", "kilohertz"),
    "mhz": ("megahertz", "megahertz"), "v": ("volt", "volts"),
    "kv": ("kilovolt", "kilovolts"), "gb": ("gigabyte", "gigabytes"),
    "mb": ("megabyte", "megabytes"), "ms": ("millisecond", "milliseconds"),
    "°c": ("degree Celsius", "degrees Celsius"),
}


class NormalizationError(ValueError):
    """Invalid locale, lexicon, or input policy."""


class NormalizationDiagnostic(FrozenContract):
    severity: Literal["warning", "error"]
    code: str = Field(..., min_length=1, max_length=128)
    message: str = Field(..., min_length=1, max_length=1000)
    block_span: SourceSpan
    source_span: SourceSpan
    token: str = Field(..., min_length=1)


class NormalizationChange(FrozenContract):
    rule_id: str = Field(..., min_length=1, max_length=128)
    original: str
    replacement: str
    block_span: SourceSpan
    source_span: SourceSpan
    source_span_exact: bool


class NormalizedBlock(FrozenContract):
    schema_version: Literal["0.1.0"] = NORMALIZATION_VERSION
    normalization_version: Literal["0.1.0"] = NORMALIZATION_VERSION
    block_id: str
    source_document_sha256: str
    language: str
    display_text: str
    spoken_text: str
    changes: tuple[NormalizationChange, ...] = ()
    diagnostics: tuple[NormalizationDiagnostic, ...] = ()


class PronunciationLexicon(FrozenContract):
    schema_version: Literal["0.1.0"] = NORMALIZATION_VERSION
    entries: tuple[PronunciationEntry, ...] = ()

    @model_validator(mode="after")
    def _entries_are_unambiguous(self) -> PronunciationLexicon:
        seen: dict[tuple[str, str, bool], str] = {}
        for entry in self.entries:
            key = (
                entry.language.lower(),
                entry.display if entry.case_sensitive else entry.display.casefold(),
                entry.case_sensitive,
            )
            prior = seen.get(key)
            if prior is not None and prior != entry.spoken:
                raise ValueError(f"conflicting pronunciation entries for {entry.display!r}")
            seen[key] = entry.spoken
        return self


@dataclass(frozen=True)
class _Candidate:
    start: int
    end: int
    replacement: str
    rule_id: str
    priority: int


def _under_hundred(value: int) -> str:
    if value < 20:
        return _ONES[value]
    tens, ones = divmod(value, 10)
    return _TENS[tens] if not ones else f"{_TENS[tens]}-{_ONES[ones]}"


def cardinal(value: int) -> str:
    """Render a signed English integer up to 999,999,999,999."""
    if abs(value) >= 1_000_000_000_000:
        raise NormalizationError("integer exceeds supported magnitude 999,999,999,999")
    if value < 0:
        return f"minus {cardinal(-value)}"
    if value < 100:
        return _under_hundred(value)
    if value < 1_000:
        hundreds, rest = divmod(value, 100)
        return f"{_ONES[hundreds]} hundred" + (f" {cardinal(rest)}" if rest else "")
    for scale, name in ((1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand")):
        if value >= scale:
            head, rest = divmod(value, scale)
            return f"{cardinal(head)} {name}" + (f" {cardinal(rest)}" if rest else "")
    raise AssertionError("unreachable")


def ordinal(value: int) -> str:
    if value in _ORDINAL_SMALL:
        return _ORDINAL_SMALL[value]
    if value < 100:
        tens, ones = divmod(value, 10)
        return f"{_TENS[tens]}-{_ORDINAL_SMALL[ones]}"
    base = cardinal(value)
    if base.endswith("y"):
        return base[:-1] + "ieth"
    replacements = {
        "one": "first", "two": "second", "three": "third", "five": "fifth",
        "eight": "eighth", "nine": "ninth", "twelve": "twelfth",
    }
    prefix, separator, last = base.rpartition(" ")
    converted = replacements.get(last, last + "th")
    return f"{prefix}{separator}{converted}"


def decimal(value: str) -> str:
    sign = "minus " if value.startswith("-") else ""
    value = value.lstrip("+-")
    whole, fraction = value.split(".", 1)
    return f"{sign}{cardinal(int(whole))} point {' '.join(_ONES[int(digit)] for digit in fraction)}"


def year(value: int) -> str:
    if 2000 <= value <= 2009:
        return "two thousand" + (f" {_ONES[value - 2000]}" if value != 2000 else "")
    if 2010 <= value <= 2099:
        return f"twenty {_under_hundred(value - 2000)}"
    return cardinal(value)


def _number_value(token: str) -> float:
    return float(token.replace(",", ""))


def _spoken_number(token: str) -> str:
    clean = token.replace(",", "")
    return decimal(clean) if "." in clean else cardinal(int(clean))


def _source_location(
    block: SpokenBlock, document: SourceDocument, local: SourceSpan
) -> tuple[SourceSpan, bool]:
    if len(block.source_spans) == 1:
        outer = block.source_spans[0]
        encoded = document.text[outer.start : outer.end]
        if encoded == block.display_text:
            return SourceSpan(start=outer.start + local.start, end=outer.start + local.end), True
        return outer, False
    return block.source_spans[0], False


def _matches(pattern: str, text: str, flags: int = 0) -> Iterable[re.Match[str]]:
    return re.finditer(pattern, text, flags)


def normalize_block(
    block: SpokenBlock,
    document: SourceDocument,
    *,
    lexicon: PronunciationLexicon | None = None,
    locale: str = "en-US",
) -> NormalizedBlock:
    """Normalize one block using ordered, non-overlapping, auditable rules."""
    if locale != "en-US" or not block.language.lower().startswith("en"):
        raise NormalizationError(
            f"unsupported normalization locale {locale!r} for language {block.language!r}; only en-US is implemented"
        )
    if block.source_document_sha256 != document.content_sha256:
        raise NormalizationError("block source identity does not match SourceDocument")
    text = block.display_text
    candidates: list[_Candidate] = []
    diagnostics_raw: list[tuple[str, str, str, int, int, str]] = []

    def add(match: re.Match[str], replacement: str, rule: str, priority: int) -> None:
        if match.group(0) != replacement:
            candidates.append(_Candidate(match.start(), match.end(), replacement, rule, priority))

    # Episode/project lexicon wins over all generic interpretation.
    for entry in (lexicon.entries if lexicon else ()):
        if entry.language.lower() not in {locale.lower(), "en", "en-us"}:
            continue
        flags = 0 if entry.case_sensitive else re.IGNORECASE
        pattern = rf"(?<!\w){re.escape(entry.display)}(?!\w)"
        for match in _matches(pattern, text, flags):
            add(match, entry.spoken, f"lexicon.{entry.entry_id}", 0)

    # Formatting characters with deterministic spoken behavior.
    for match in _matches(r"`", text):
        add(match, "", "markup.inline-code-delimiter", 5)
    for match in _matches(r"--(?=[A-Za-z][A-Za-z0-9-]*\b)", text):
        add(match, "dash dash ", "technical.long-option", 6)
    for match in _matches(r"\bv(\d+)\.(\d+)(?:\.(\d+))?\b", text, re.IGNORECASE):
        parts = [group for group in match.groups() if group is not None]
        spoken = " point ".join(" ".join(_ONES[int(d)] for d in part) for part in parts)
        add(match, "version " + spoken, "technical.version", 10)

    months = "|".join(_MONTHS)
    date_pattern = rf"\b(?P<month>{months})\s+(?P<day>\d{{1,2}})(?:st|nd|rd|th)?,\s+(?P<year>\d{{4}})\b"
    for match in _matches(date_pattern, text, re.IGNORECASE):
        day = int(match.group("day"))
        month_key = match.group("month").lower()
        year_value = int(match.group("year"))
        try:
            date(year_value, _MONTH_NUMBERS[month_key], day)
        except ValueError:
            diagnostics_raw.append(("error", "date.invalid-calendar-date", "Date is not valid on the Gregorian calendar.", match.start(), match.end(), match.group(0)))
        else:
            add(match, f"{_MONTHS[month_key]} {ordinal(day)}, {year(year_value)}", "date.month-day-year", 12)

    time_pattern = r"\b(?P<hour>1[0-2]|0?[1-9]):(?P<minute>[0-5]\d)\s*(?P<suffix>a\.m\.|p\.m\.)(?!\w)"
    for match in _matches(time_pattern, text, re.IGNORECASE):
        hour = cardinal(int(match.group("hour")))
        minute_value = int(match.group("minute"))
        minute = "oh " + _ONES[minute_value] if 0 < minute_value < 10 else cardinal(minute_value) if minute_value else "o'clock"
        suffix = match.group("suffix").lower()
        add(match, f"{hour} {minute} {suffix}", "time.twelve-hour", 13)

    for match in _matches(r"(?<!\w)\$(?P<amount>\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)(?!\d|[.,]\d)", text):
        amount = match.group("amount").replace(",", "")
        dollars_text, dot, cents_text = amount.partition(".")
        dollars = int(dollars_text)
        cents = int(cents_text) if dot else 0
        spoken = f"{cardinal(dollars)} {'dollar' if dollars == 1 else 'dollars'}"
        if cents:
            spoken += f" and {cardinal(cents)} {'cent' if cents == 1 else 'cents'}"
        add(match, spoken, "currency.usd", 14)

    number_token = r"-?\d+(?:,\d{3})*(?:\.\d+)?"
    unit_names = "|".join(sorted((re.escape(unit) for unit in _UNITS), key=len, reverse=True))
    for match in _matches(rf"(?<!\w)(?P<number>{number_token})\s*(?P<unit>{unit_names})\b", text, re.IGNORECASE):
        token = match.group("number")
        singular, plural = _UNITS[match.group("unit").lower()]
        # A unit before another noun is a singular compound modifier: "five kilometer sensor".
        compound_modifier = bool(re.match(r"\s+[A-Za-z]", text[match.end() :]))
        unit_spoken = singular if _number_value(token) == 1 or compound_modifier else plural
        add(match, f"{_spoken_number(token)} {unit_spoken}", "unit.si-context", 15)

    for match in _matches(rf"(?<!\w)(?P<number>{number_token})%", text):
        add(match, f"{_spoken_number(match.group('number'))} percent", "number.percentage", 16)
    for match in _matches(r"(?<!\w)(?P<number>\d+)(?:st|nd|rd|th)\b", text, re.IGNORECASE):
        add(match, ordinal(int(match.group("number"))), "number.ordinal", 17)
    for abbreviation, replacement in _ABBREVIATIONS.items():
        for match in _matches(rf"(?<!\w){re.escape(abbreviation)}", text, re.IGNORECASE):
            add(match, replacement, f"abbreviation.{abbreviation.rstrip('.')}", 18)
    for match in _matches(r"\b[A-Z]{2,5}\b", text):
        add(match, " ".join(match.group(0)), "abbreviation.initialism", 20)
    for match in _matches(rf"(?<![\w.]){number_token}(?![\w.])", text):
        add(match, _spoken_number(match.group(0)), "number.cardinal-or-decimal", 30)
    for match in _matches(r"(?<=\s)&(?=\s)", text):
        add(match, "and", "symbol.ampersand", 35)
    for match in _matches(r"(?<=\s)\+(?=\s)", text):
        add(match, "plus", "symbol.plus", 35)
    for match in _matches(r"^\s+|\s+$", text):
        add(match, "", "whitespace.trim", 89)
    for match in _matches(r"[^\S\r\n]+", text):
        add(match, " ", "whitespace.horizontal", 90)
    for match in _matches(r"(?:\r\n|\r|\n)+", text):
        add(match, " ", "whitespace.line-break", 91)

    # Per-codepoint compatibility normalization is deliberately late.
    for index, character in enumerate(text):
        normalized = unicodedata.normalize("NFKC", character)
        if normalized != character:
            candidates.append(_Candidate(index, index + 1, normalized, "unicode.nfkc", 95))

    # Ambiguous/protected forms are retained and surfaced, never guessed.
    diagnostic_rules = (
        (r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", "error", "date.ambiguous-numeric", "Numeric date is locale-ambiguous; use a written month."),
        (r"[€£¥]\s?\d", "error", "currency.unsupported", "Currency requires an explicit locale/currency rule."),
        (r"\$\d+(?:\.\d(?!\d)|\.\d{3,})", "error", "currency.invalid-precision", "US currency must use zero or exactly two decimal places."),
        (r"\b\d{1,3}(?:,\d{1,2}|,\d{4,})\b", "error", "number.invalid-grouping", "Comma-grouped number must use groups of three digits."),
        (r"\b(?:https?://|www\.)\S+", "warning", "protected.url", "URL was preserved; provide a lexicon entry for intended speech."),
        (r"\b[\w.+-]+@[\w.-]+\.\w+\b", "warning", "protected.email", "Email address was preserved; provide a lexicon entry for intended speech."),
        (r"\b\d{1,2}:\d{2}\b(?!\s*(?:a\.m\.|p\.m\.))", "error", "time.ambiguous", "Time without a.m./p.m. or an explicit 24-hour policy is ambiguous."),
        (r"(?<!\w)St\.(?!\w)", "error", "abbreviation.ambiguous-st", "St. may mean Saint or Street; provide a lexicon entry."),
        (r"\b[A-Za-z]+-\d+[A-Za-z0-9-]*\b", "warning", "technical.identifier", "Mixed identifier was preserved; provide a lexicon entry for intended speech."),
        (r"(?<![\d:.,])0\d+\b", "error", "number.leading-zero", "Leading-zero number may be an identifier; provide a lexicon entry."),
        (r"(?<![\d/])\d+\s*/\s*\d+(?!\s*/|\d)", "error", "number.ambiguous-fraction", "Slash form may be a fraction or identifier; spell out the intended form."),
        (r"\b\d+\s*[-–]\s*\d+\b", "error", "number.ambiguous-range", "Numeric range requires an explicit range policy; spell out 'to' if intended."),
    )
    protected_spans: list[tuple[int, int]] = [
        (start, end) for _, _, _, start, end, _ in diagnostics_raw
    ]
    for pattern, severity, code, message in diagnostic_rules:
        for match in _matches(pattern, text, re.IGNORECASE if code.startswith("protected") else 0):
            diagnostics_raw.append((severity, code, message, match.start(), match.end(), match.group(0)))
            protected_spans.append((match.start(), match.end()))

    # Select priority-first without permitting overlap or rewriting unresolved forms.
    selected: list[_Candidate] = []
    for candidate in sorted(candidates, key=lambda item: (item.priority, item.start, -(item.end - item.start))):
        overlaps_protected = any(
            candidate.start < end and start < candidate.end
            for start, end in protected_spans
        )
        if overlaps_protected and not candidate.rule_id.startswith("lexicon."):
            continue
        if any(candidate.start < prior.end and prior.start < candidate.end for prior in selected):
            continue
        selected.append(candidate)
    selected.sort(key=lambda item: item.start)

    pieces: list[str] = []
    cursor = 0
    changes: list[NormalizationChange] = []
    for candidate in selected:
        pieces.append(text[cursor:candidate.start])
        pieces.append(candidate.replacement)
        local = SourceSpan(start=candidate.start, end=candidate.end)
        source_span, exact = _source_location(block, document, local)
        changes.append(
            NormalizationChange(
                rule_id=candidate.rule_id,
                original=text[candidate.start:candidate.end],
                replacement=candidate.replacement,
                block_span=local,
                source_span=source_span,
                source_span_exact=exact,
            )
        )
        cursor = candidate.end
    pieces.append(text[cursor:])
    spoken_text = "".join(pieces).strip()
    if not spoken_text:
        raise NormalizationError("normalization produced empty spoken text")

    diagnostics: list[NormalizationDiagnostic] = []
    for severity, code, message, start, end, token in diagnostics_raw:
        if any(
            change.rule_id.startswith("lexicon.")
            and change.block_span.start < end
            and start < change.block_span.end
            for change in changes
        ):
            continue
        local = SourceSpan(start=start, end=end)
        source_span, _ = _source_location(block, document, local)
        diagnostics.append(
            NormalizationDiagnostic(
                severity=severity,
                code=code,
                message=message,
                block_span=local,
                source_span=source_span,
                token=token,
            )
        )
    return NormalizedBlock(
        block_id=block.block_id,
        source_document_sha256=document.content_sha256,
        language=block.language,
        display_text=block.display_text,
        spoken_text=spoken_text,
        changes=tuple(changes),
        diagnostics=tuple(diagnostics),
    )


def normalize_ingestion(
    result: IngestionResult,
    *,
    lexicon: PronunciationLexicon | None = None,
    locale: str = "en-US",
) -> tuple[NormalizedBlock, ...]:
    return tuple(
        normalize_block(block, result.source, lexicon=lexicon, locale=locale)
        for block in result.spoken_blocks
    )
