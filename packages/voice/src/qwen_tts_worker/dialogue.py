"""Deterministic source-mapped narration, dialogue, and attribution turns."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import Field, model_validator

from qwen_tts_worker.models.quality import (
    FrozenContract,
    SourceDocument,
    SourceSpan,
    SpeechRole,
    SpokenBlock,
)


DIALOGUE_VERSION = "0.1.0"
_ATTRIBUTION_VERBS = (
    "said", "asked", "whispered", "cried", "called", "replied", "shouted",
    "shout", "murmured", "exclaimed", "answered", "added", "warned", "sighed",
)


class DialogueError(ValueError):
    """Invalid source identity or speaker-directory configuration."""


class SpeakerEntry(FrozenContract):
    """A stable voice profile and explicit textual character aliases."""

    profile_id: str = Field(..., min_length=1, max_length=128)
    aliases: tuple[str, ...] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _aliases_are_nonempty(self) -> SpeakerEntry:
        if any(not alias.strip() for alias in self.aliases):
            raise ValueError("speaker aliases cannot be empty")
        return self


class SpeakerDirectory(FrozenContract):
    """Reviewed character aliases; pronouns are intentionally not inferred."""

    schema_version: Literal["0.1.0"] = DIALOGUE_VERSION
    speakers: tuple[SpeakerEntry, ...] = ()

    @model_validator(mode="after")
    def _aliases_are_unique(self) -> SpeakerDirectory:
        seen: dict[str, str] = {}
        for speaker in self.speakers:
            for alias in speaker.aliases:
                key = alias.casefold()
                prior = seen.get(key)
                if prior is not None and prior != speaker.profile_id:
                    raise ValueError(
                        f"speaker alias {alias!r} maps to both {prior!r} and {speaker.profile_id!r}"
                    )
                seen[key] = speaker.profile_id
        return self


class StructuralToken(FrozenContract):
    """Non-spoken quote/whitespace retained for exact conservation."""

    kind: Literal["quote-mark", "whitespace"]
    text: str = Field(..., min_length=1)
    block_span: SourceSpan
    source_span: SourceSpan
    source_span_exact: bool


class DialogueDiagnostic(FrozenContract):
    severity: Literal["warning", "error"]
    code: str = Field(..., min_length=1, max_length=128)
    message: str = Field(..., min_length=1, max_length=1000)
    block_span: SourceSpan
    source_span: SourceSpan
    source_span_exact: bool


class SpeechTurn(FrozenContract):
    """One contiguous narration or character utterance."""

    schema_version: Literal["0.1.0"] = DIALOGUE_VERSION
    turn_id: str = Field(..., min_length=1, max_length=256)
    source_block_id: str = Field(..., min_length=1, max_length=256)
    source_document_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    block_span: SourceSpan
    source_span: SourceSpan
    source_span_exact: bool
    role: SpeechRole
    speaker_profile_id: str = Field(..., min_length=1, max_length=128)
    display_text: str = Field(..., min_length=1)
    spoken_text: str = Field(..., min_length=1)
    quote_depth: int = Field(default=0, ge=0)


class DialogueAnalysis(FrozenContract):
    schema_version: Literal["0.1.0"] = DIALOGUE_VERSION
    dialogue_version: Literal["0.1.0"] = DIALOGUE_VERSION
    source_block_id: str
    source_document_sha256: str
    turns: tuple[SpeechTurn, ...] = Field(..., min_length=1)
    structural_tokens: tuple[StructuralToken, ...] = ()
    diagnostics: tuple[DialogueDiagnostic, ...] = ()


@dataclass
class _Quote:
    open_index: int
    close_index: int
    depth: int
    opener: str
    closer: str
    speaker: str = "review-required"


@dataclass(frozen=True)
class _RawDiagnostic:
    code: str
    message: str
    start: int
    end: int


def _source_location(
    block: SpokenBlock, document: SourceDocument, local: SourceSpan
) -> tuple[SourceSpan, bool]:
    if len(block.source_spans) == 1:
        outer = block.source_spans[0]
        encoded = document.text[outer.start : outer.end]
        if encoded == block.display_text:
            return SourceSpan(start=outer.start + local.start, end=outer.start + local.end), True
        return outer, False
    return SourceSpan(
        start=min(span.start for span in block.source_spans),
        end=max(span.end for span in block.source_spans),
    ), False


def _parse_quotes(text: str) -> tuple[list[_Quote], list[_RawDiagnostic]]:
    quotes: list[_Quote] = []
    diagnostics: list[_RawDiagnostic] = []
    stack: list[tuple[int, str, str, int]] = []
    explicit_openers = {"“": "”", "‘": "’"}
    explicit_closers = {"”", "’"}

    for index, character in enumerate(text):
        if character in explicit_openers:
            stack.append((index, character, explicit_openers[character], len(stack) + 1))
        elif character == '"':
            if stack and stack[-1][2] == '"':
                opening, opener, closer, depth = stack.pop()
                quotes.append(_Quote(opening, index, depth, opener, closer))
            else:
                stack.append((index, character, character, len(stack) + 1))
        elif character in explicit_closers:
            if (
                character == "’"
                and (not stack or stack[-1][2] != character)
                and index > 0
                and text[index - 1].isalnum()
            ):
                continue  # typographic apostrophe, not a quotation delimiter
            if stack and stack[-1][2] == character:
                opening, opener, closer, depth = stack.pop()
                quotes.append(_Quote(opening, index, depth, opener, closer))
            else:
                diagnostics.append(
                    _RawDiagnostic(
                        "dialogue.unmatched-close-quote",
                        f"Closing quote {character!r} has no matching opener.",
                        index,
                        index + 1,
                    )
                )
    for opening, opener, closer, _ in stack:
        diagnostics.append(
            _RawDiagnostic(
                "dialogue.unclosed-quote",
                f"Opening quote {opener!r} requires closing quote {closer!r}.",
                opening,
                opening + 1,
            )
        )
    return sorted(quotes, key=lambda quote: quote.open_index), diagnostics


def _alias_candidates(context: str, directory: SpeakerDirectory) -> set[str]:
    verbs = "|".join(_ATTRIBUTION_VERBS)
    candidates: set[str] = set()
    for speaker in directory.speakers:
        for alias in sorted(speaker.aliases, key=len, reverse=True):
            escaped = re.escape(alias)
            patterns = (
                rf"(?<!\w){escaped}(?!\w)\s+(?:{verbs})\b",
                rf"\b(?:{verbs})\s+(?<!\w){escaped}(?!\w)",
            )
            if any(re.search(pattern, context, re.IGNORECASE) for pattern in patterns):
                candidates.add(speaker.profile_id)
    return candidates


def _sentence_before(text: str, index: int, limit: int = 180) -> str:
    fragment = text[max(0, index - limit) : index]
    # A prior quote boundary retains its adjacent attribution ("..." Mira said. "...")
    # while excluding attribution belonging to an earlier utterance.
    quote_boundary = max(
        fragment.rfind('"'), fragment.rfind("“"), fragment.rfind("”"),
        fragment.rfind("‘"), fragment.rfind("’"),
    )
    if quote_boundary >= 0:
        return fragment[quote_boundary + 1 :]
    sentence_boundary = max(fragment.rfind("."), fragment.rfind("!"), fragment.rfind("?"))
    return fragment[sentence_boundary + 1 :]


def _sentence_after(text: str, index: int, limit: int = 180) -> str:
    fragment = text[index : index + limit]
    boundaries = [position for mark in ".!?" if (position := fragment.find(mark)) >= 0]
    return fragment[: min(boundaries) + 1] if boundaries else fragment


def _resolve_speakers(
    text: str,
    quotes: list[_Quote],
    block: SpokenBlock,
    directory: SpeakerDirectory,
) -> list[_RawDiagnostic]:
    diagnostics: list[_RawDiagnostic] = []
    for quote in quotes:
        if block.role == SpeechRole.DIALOGUE and block.speaker != "unresolved":
            quote.speaker = block.speaker
            continue
        before = _sentence_before(text, quote.open_index)
        after = _sentence_after(text, quote.close_index + 1)
        candidates = _alias_candidates(before, directory) | _alias_candidates(after, directory)
        if len(candidates) == 1:
            quote.speaker = next(iter(candidates))
        elif not candidates:
            diagnostics.append(
                _RawDiagnostic(
                    "dialogue.speaker-unresolved",
                    "Quoted speech has no explicit reviewed character attribution.",
                    quote.open_index,
                    quote.close_index + 1,
                )
            )
        else:
            diagnostics.append(
                _RawDiagnostic(
                    "dialogue.speaker-ambiguous",
                    f"Quoted speech matches multiple speaker profiles: {', '.join(sorted(candidates))}.",
                    quote.open_index,
                    quote.close_index + 1,
                )
            )
    return diagnostics


def _turn_id(block: SpokenBlock, span: SourceSpan, role: SpeechRole, speaker: str) -> str:
    material = (
        f"{block.source_document_sha256}\0{block.block_id}\0{span.start}:{span.end}"
        f"\0{role.value}\0{speaker}"
    ).encode()
    return f"{block.block_id}.turn.{hashlib.sha256(material).hexdigest()[:12]}"


def analyze_dialogue(
    block: SpokenBlock,
    document: SourceDocument,
    *,
    speakers: SpeakerDirectory | None = None,
    narrator_profile_id: str = "narrator",
) -> DialogueAnalysis:
    """Partition a spoken block while keeping attribution in narrator turns."""

    if block.source_document_sha256 != document.content_sha256:
        raise DialogueError("block source identity does not match SourceDocument")
    directory = speakers or SpeakerDirectory()
    if not narrator_profile_id.strip():
        raise DialogueError("narrator_profile_id cannot be empty")
    text = block.display_text
    quotes, raw_diagnostics = _parse_quotes(text)

    # Malformed quotation structure is never partially interpreted.
    if raw_diagnostics:
        quotes = []
    else:
        raw_diagnostics.extend(_resolve_speakers(text, quotes, block, directory))
        if not quotes and block.role == SpeechRole.DIALOGUE and block.speaker == "unresolved":
            raw_diagnostics.append(
                _RawDiagnostic(
                    "dialogue.speaker-unresolved",
                    "Dialogue block has no reviewed character speaker profile.",
                    0,
                    len(text),
                )
            )

    opening = {quote.open_index: quote for quote in quotes}
    closing = {quote.close_index: quote for quote in quotes}
    active: list[_Quote] = []
    raw_segments: list[tuple[int, int, SpeechRole, str, int]] = []
    structural_local: list[tuple[str, int, int]] = []
    segment_start = 0

    def emit(start: int, end: int) -> None:
        if end <= start:
            return
        if text[start:end].isspace():
            structural_local.append(("whitespace", start, end))
            return
        leading = len(text[start:end]) - len(text[start:end].lstrip())
        trailing_end = end - (len(text[start:end]) - len(text[start:end].rstrip()))
        content_start = start + leading
        content_end = trailing_end
        if content_start > start:
            structural_local.append(("whitespace", start, content_start))
        if content_end > content_start:
            if active:
                raw_segments.append(
                    (content_start, content_end, SpeechRole.DIALOGUE, active[-1].speaker, active[-1].depth)
                )
            else:
                role = block.role if not quotes else SpeechRole.NARRATOR
                speaker = (
                    block.speaker
                    if role == SpeechRole.DIALOGUE and block.speaker != "unresolved"
                    else "review-required" if role == SpeechRole.DIALOGUE else narrator_profile_id
                )
                raw_segments.append((content_start, content_end, role, speaker, 0))
        if content_end < end:
            structural_local.append(("whitespace", content_end, end))

    for index, character in enumerate(text):
        if index in opening:
            emit(segment_start, index)
            structural_local.append(("quote-mark", index, index + 1))
            active.append(opening[index])
            segment_start = index + 1
        elif index in closing:
            emit(segment_start, index)
            structural_local.append(("quote-mark", index, index + 1))
            target = closing[index]
            if active and active[-1] is target:
                active.pop()
            segment_start = index + 1
    emit(segment_start, len(text))

    if not raw_segments:
        raise DialogueError("dialogue analysis produced no speech turns")

    turns: list[SpeechTurn] = []
    for start, end, role, speaker, depth in raw_segments:
        local = SourceSpan(start=start, end=end)
        source_span, exact = _source_location(block, document, local)
        content = text[start:end]
        turns.append(
            SpeechTurn(
                turn_id=_turn_id(block, local, role, speaker),
                source_block_id=block.block_id,
                source_document_sha256=document.content_sha256,
                block_span=local,
                source_span=source_span,
                source_span_exact=exact,
                role=role,
                speaker_profile_id=speaker,
                display_text=content,
                spoken_text=content,
                quote_depth=depth,
            )
        )

    structural: list[StructuralToken] = []
    for kind, start, end in sorted(structural_local, key=lambda item: item[1]):
        local = SourceSpan(start=start, end=end)
        source_span, exact = _source_location(block, document, local)
        structural.append(
            StructuralToken(
                kind=kind, text=text[start:end], block_span=local,
                source_span=source_span, source_span_exact=exact,
            )
        )

    diagnostics: list[DialogueDiagnostic] = []
    for diagnostic in raw_diagnostics:
        local = SourceSpan(start=diagnostic.start, end=diagnostic.end)
        source_span, exact = _source_location(block, document, local)
        diagnostics.append(
            DialogueDiagnostic(
                severity="error",
                code=diagnostic.code,
                message=diagnostic.message,
                block_span=local,
                source_span=source_span,
                source_span_exact=exact,
            )
        )

    return DialogueAnalysis(
        source_block_id=block.block_id,
        source_document_sha256=document.content_sha256,
        turns=tuple(turns),
        structural_tokens=tuple(structural),
        diagnostics=tuple(diagnostics),
    )


def analyze_ingestion_dialogue(
    blocks: tuple[SpokenBlock, ...],
    document: SourceDocument,
    *,
    speakers: SpeakerDirectory | None = None,
    narrator_profile_id: str = "narrator",
) -> tuple[DialogueAnalysis, ...]:
    return tuple(
        analyze_dialogue(
            block,
            document,
            speakers=speakers,
            narrator_profile_id=narrator_profile_id,
        )
        for block in blocks
    )
