"""Deterministic semantic/prosodic segmentation with stable content IDs."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from statistics import median
from typing import Literal

from pydantic import Field, model_validator

from qwen_tts_worker.models.quality import (
    FrozenContract,
    SegmentContext,
    SourceSpan,
    SpeechRole,
)


SEGMENTATION_VERSION = "0.1.0"
_WORD_RE = re.compile(r"[^\W_]+(?:[-'][^\W_]+)*", re.UNICODE)
_BACKEND_TOKEN_RE = re.compile(r"\w+|[^\w\s]", re.UNICODE)
_TOKEN_RE = re.compile(r"\s+|[^\s]+", re.UNICODE)
_PROTECTED_PATTERNS = (
    r"https?://\S+",
    r"\b[\w.+-]+@[\w.-]+\.\w+\b",
    r"\bv?\d+(?:\.\d+){1,}\b",
    r"\b(?:[A-Za-z]\.){2,}",
    r"\b(?:Mr|Mrs|Ms|Dr|Prof|St)\.",
    r"\b\d+(?:,\d{3})*(?:\.\d+)?%?\b",
)


class SegmentationError(ValueError):
    """Input cannot be segmented without violating a hard safety rule."""


class RoleLimits(FrozenContract):
    min_words: int = Field(..., ge=1, le=500)
    target_words: int = Field(..., ge=1, le=500)
    max_words: int = Field(..., ge=1, le=500)
    target_duration_seconds: float = Field(..., gt=0, le=120)
    max_duration_seconds: float = Field(..., gt=0, le=120)

    @model_validator(mode="after")
    def _ordered(self) -> RoleLimits:
        if not self.min_words <= self.target_words <= self.max_words:
            raise ValueError("word limits must satisfy min <= target <= max")
        if self.target_duration_seconds > self.max_duration_seconds:
            raise ValueError("duration target cannot exceed maximum")
        return self


class SegmentationPolicy(FrozenContract):
    schema_version: Literal["0.1.0"] = SEGMENTATION_VERSION
    policy_id: str = "semantic-en-v1"
    narration: RoleLimits = Field(
        default_factory=lambda: RoleLimits(
            min_words=25,
            target_words=45,
            max_words=70,
            target_duration_seconds=18.0,
            max_duration_seconds=28.0,
        )
    )
    dialogue: RoleLimits = Field(
        default_factory=lambda: RoleLimits(
            min_words=8,
            target_words=24,
            max_words=40,
            target_duration_seconds=10.0,
            max_duration_seconds=17.0,
        )
    )
    max_backend_tokens: int = Field(default=180, ge=16, le=2048)
    max_characters: int = Field(default=500, ge=64, le=4000)
    words_per_second: float = Field(default=2.6, gt=0.5, le=8.0)
    context_characters: int = Field(default=240, ge=0, le=1000)
    sentence_pause_ms: int = Field(default=220, ge=0, le=2000)
    clause_pause_ms: int = Field(default=120, ge=0, le=2000)
    fallback_pause_ms: int = Field(default=80, ge=0, le=2000)
    same_speaker_turn_pause_ms: int = Field(default=220, ge=0, le=3000)
    speaker_transition_pause_ms: int = Field(default=350, ge=0, le=3000)


class SegmentationInput(FrozenContract):
    """One hard-bounded speech turn ready for semantic segmentation."""

    schema_version: Literal["0.1.0"] = SEGMENTATION_VERSION
    source_anchor_id: str = Field(..., min_length=1, max_length=256)
    source_document_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    source_block_ids: tuple[str, ...] = Field(..., min_length=1)
    source_spans: tuple[SourceSpan, ...] = Field(..., min_length=1)
    source_spans_exact: bool = False
    display_text: str = Field(..., min_length=1)
    spoken_text: str = Field(..., min_length=1)
    language: str = Field(..., min_length=2, max_length=35)
    role: SpeechRole
    speaker_profile_id: str = Field(..., min_length=1, max_length=128)
    protected_spoken_spans: tuple[SourceSpan, ...] = ()
    pause_after_ms: int | None = Field(default=None, ge=0, le=10_000)

    @model_validator(mode="after")
    def _text_and_spans(self) -> SegmentationInput:
        if self.display_text != self.display_text.strip() or self.spoken_text != self.spoken_text.strip():
            raise ValueError("segmentation input text must not have outer whitespace")
        for span in self.protected_spoken_spans:
            if span.end > len(self.spoken_text):
                raise ValueError("protected spoken span exceeds spoken_text")
        if not _WORD_RE.search(self.spoken_text):
            raise ValueError("segmentation input must contain at least one spoken word")
        return self


class PauseIntent(FrozenContract):
    kind: Literal["sentence", "clause", "fallback", "turn", "speaker-transition", "explicit"]
    duration_hint_ms: int = Field(..., ge=0, le=10_000)


class SemanticSegment(FrozenContract):
    schema_version: Literal["0.1.0"] = SEGMENTATION_VERSION
    segmentation_version: Literal["0.1.0"] = SEGMENTATION_VERSION
    policy_id: str = Field(..., min_length=1, max_length=128)
    policy_fingerprint: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    segment_id: str = Field(..., min_length=1, max_length=256)
    source_anchor_id: str
    source_document_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    source_block_ids: tuple[str, ...] = Field(..., min_length=1)
    source_spans: tuple[SourceSpan, ...] = Field(..., min_length=1)
    source_spans_exact: bool
    display_text: str = Field(..., min_length=1)
    spoken_text: str = Field(..., min_length=1)
    display_separator_after: str = ""
    spoken_separator_after: str = ""
    language: str
    role: SpeechRole
    speaker_profile_id: str
    word_count: int = Field(..., ge=1)
    backend_token_count: int = Field(..., ge=1)
    predicted_duration_seconds: float = Field(..., gt=0)
    boundary_reason: Literal["sentence", "clause", "fallback", "turn-end"]
    pause: PauseIntent
    context: SegmentContext = Field(default_factory=SegmentContext)


class SegmentationReport(FrozenContract):
    schema_version: Literal["0.1.0"] = SEGMENTATION_VERSION
    policy_id: str
    policy_fingerprint: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    input_turn_count: int = Field(..., ge=1)
    segment_count: int = Field(..., ge=1)
    total_words: int = Field(..., ge=1)
    total_backend_tokens: int = Field(..., ge=1)
    total_predicted_duration_seconds: float = Field(..., gt=0)
    min_words: int = Field(..., ge=1)
    median_words: float = Field(..., ge=1)
    max_words: int = Field(..., ge=1)
    min_predicted_duration_seconds: float = Field(..., gt=0)
    median_predicted_duration_seconds: float = Field(..., gt=0)
    max_predicted_duration_seconds: float = Field(..., gt=0)
    boundary_reason_counts: dict[str, int]
    segments_over_target_words: int = Field(..., ge=0)
    segments_at_hard_limit: int = Field(..., ge=0)


class SegmentationResult(FrozenContract):
    schema_version: Literal["0.1.0"] = SEGMENTATION_VERSION
    segments: tuple[SemanticSegment, ...] = Field(..., min_length=1)
    report: SegmentationReport


@dataclass(frozen=True)
class _Alignment:
    spoken_to_display: dict[int, int]
    protected: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class _Boundary:
    content_end: int
    next_start: int
    reason: Literal["sentence", "clause", "fallback"]


@dataclass(frozen=True)
class _Metrics:
    words: int
    tokens: int
    characters: int
    duration: float


def _alignment(display: str, spoken: str) -> _Alignment:
    display_tokens = [(match.group(), match.start(), match.end()) for match in _TOKEN_RE.finditer(display)]
    spoken_tokens = [(match.group(), match.start(), match.end()) for match in _TOKEN_RE.finditer(spoken)]
    matcher = SequenceMatcher(
        None,
        [token[0] for token in display_tokens],
        [token[0] for token in spoken_tokens],
        autojunk=False,
    )
    mapping: dict[int, int] = {0: 0}
    protected: list[tuple[int, int]] = []
    display_cursor = 0
    spoken_cursor = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        d_start = display_tokens[i1][1] if i1 < len(display_tokens) else len(display)
        d_end = display_tokens[i2 - 1][2] if i2 > i1 else d_start
        s_start = spoken_tokens[j1][1] if j1 < len(spoken_tokens) else len(spoken)
        s_end = spoken_tokens[j2 - 1][2] if j2 > j1 else s_start
        mapping[s_start] = d_start
        if tag == "equal":
            for d_token, s_token in zip(display_tokens[i1:i2], spoken_tokens[j1:j2]):
                mapping[s_token[1]] = d_token[1]
                mapping[s_token[2]] = d_token[2]
        elif s_end > s_start:
            protected.append((s_start, s_end))
        mapping[s_end] = d_end
        display_cursor, spoken_cursor = d_end, s_end
    mapping[len(spoken)] = len(display)
    if display_cursor < len(display) or spoken_cursor < len(spoken):
        raise SegmentationError("text alignment did not consume both display and spoken text")
    return _Alignment(mapping, tuple(protected))


def _protected_spans(text: str, supplied: tuple[SourceSpan, ...], alignment: _Alignment) -> tuple[tuple[int, int], ...]:
    spans = list(alignment.protected)
    spans.extend((span.start, span.end) for span in supplied)
    for pattern in _PROTECTED_PATTERNS:
        spans.extend((match.start(), match.end()) for match in re.finditer(pattern, text, re.IGNORECASE))
    return tuple(sorted(set(spans)))


def _inside_protected(offset: int, spans: tuple[tuple[int, int], ...]) -> bool:
    return any(start < offset < end for start, end in spans)


def _safe_offsets(text: str) -> set[int]:
    safe = {0}
    round_depth = square_depth = brace_depth = 0
    quote_stack: list[str] = []
    pairs = {"“": "”", "‘": "’"}
    for index, character in enumerate(text):
        if character == "(": round_depth += 1
        elif character == ")": round_depth = max(0, round_depth - 1)
        elif character == "[": square_depth += 1
        elif character == "]": square_depth = max(0, square_depth - 1)
        elif character == "{": brace_depth += 1
        elif character == "}": brace_depth = max(0, brace_depth - 1)
        elif character in pairs:
            quote_stack.append(pairs[character])
        elif quote_stack and character == quote_stack[-1]:
            quote_stack.pop()
        elif character == '"':
            if quote_stack and quote_stack[-1] == '"':
                quote_stack.pop()
            else:
                quote_stack.append('"')
        if not (round_depth or square_depth or brace_depth or quote_stack):
            safe.add(index + 1)
    return safe


def _metrics(text: str, policy: SegmentationPolicy) -> _Metrics:
    words = len(_WORD_RE.findall(text))
    tokens = len(_BACKEND_TOKEN_RE.findall(text))
    sentence_marks = len(re.findall(r"[.!?…]+(?=\s|$)", text))
    clause_marks = len(re.findall(r"[,;:—]", text))
    duration = words / policy.words_per_second + sentence_marks * 0.22 + clause_marks * 0.08
    return _Metrics(words, tokens, len(text), round(max(duration, 0.05), 4))


def _limits(role: SpeechRole, policy: SegmentationPolicy) -> RoleLimits:
    return policy.dialogue if role == SpeechRole.DIALOGUE else policy.narration


def _within_hard(metrics: _Metrics, limits: RoleLimits, policy: SegmentationPolicy) -> bool:
    return (
        metrics.words <= limits.max_words
        and metrics.tokens <= policy.max_backend_tokens
        and metrics.characters <= policy.max_characters
        and metrics.duration <= limits.max_duration_seconds
    )


def _candidate_boundaries(
    text: str,
    alignment: _Alignment,
    protected: tuple[tuple[int, int], ...],
) -> list[_Boundary]:
    safe = _safe_offsets(text)
    reasons: dict[int, Literal["sentence", "clause", "fallback"]] = {}
    for match in re.finditer(r'[.!?…]+(?:["”’)]*)?(?=\s|$)', text):
        reasons[match.end()] = "sentence"
    for match in re.finditer(r"[,;:—](?=\s|$)", text):
        reasons.setdefault(match.end(), "clause")
    boundaries: list[_Boundary] = []
    for end, reason in reasons.items():
        next_start = end
        while next_start < len(text) and text[next_start].isspace():
            next_start += 1
        if (
            end in safe
            and end in alignment.spoken_to_display
            and next_start in alignment.spoken_to_display
            and not _inside_protected(end, protected)
        ):
            boundaries.append(_Boundary(end, next_start, reason))
    return boundaries


def _select_boundary(
    text: str,
    start: int,
    boundaries: list[_Boundary],
    limits: RoleLimits,
    policy: SegmentationPolicy,
) -> _Boundary:
    viable: list[tuple[_Boundary, _Metrics]] = []
    for boundary in boundaries:
        if boundary.content_end <= start:
            continue
        metrics = _metrics(text[start : boundary.content_end], policy)
        if _within_hard(metrics, limits, policy):
            viable.append((boundary, metrics))
    if not viable:
        preview = text[start : start + 120]
        raise SegmentationError(
            "no syntactically safe boundary exists within hard backend limits; "
            f"review protected/parenthetical text near {preview!r}"
        )
    preferred = [(boundary, metrics) for boundary, metrics in viable if metrics.words >= limits.min_words]
    pool = preferred or viable
    penalty = {"sentence": 0.0, "clause": 0.35, "fallback": 1.0}

    def score(item: tuple[_Boundary, _Metrics]) -> tuple[float, int]:
        boundary, metrics = item
        word_distance = abs(metrics.words - limits.target_words) / limits.target_words
        duration_distance = abs(metrics.duration - limits.target_duration_seconds) / limits.target_duration_seconds
        return word_distance + duration_distance + penalty[boundary.reason], -boundary.content_end

    return min(pool, key=score)[0]


def _source_spans_for_slice(
    item: SegmentationInput,
    display_start: int,
    display_end: int,
) -> tuple[tuple[SourceSpan, ...], bool]:
    if (
        item.source_spans_exact
        and len(item.source_spans) == 1
        and item.source_spans[0].end - item.source_spans[0].start == len(item.display_text)
    ):
        outer = item.source_spans[0]
        return (
            (SourceSpan(start=outer.start + display_start, end=outer.start + display_end),),
            True,
        )
    return item.source_spans, False


def _policy_fingerprint(policy: SegmentationPolicy) -> str:
    canonical = json.dumps(
        policy.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _stable_segment_id(
    item: SegmentationInput,
    spoken_text: str,
    duplicate_occurrence: int,
) -> str:
    material = json.dumps(
        {
            "id_version": SEGMENTATION_VERSION,
            "anchor": item.source_anchor_id,
            "language": item.language,
            "role": item.role.value,
            "speaker": item.speaker_profile_id,
            "spoken_text": spoken_text,
            "duplicate_occurrence": duplicate_occurrence,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return f"seg-{hashlib.sha256(material).hexdigest()[:20]}"


def _segment_one(item: SegmentationInput, policy: SegmentationPolicy) -> list[SemanticSegment]:
    alignment = _alignment(item.display_text, item.spoken_text)
    protected = _protected_spans(item.spoken_text, item.protected_spoken_spans, alignment)
    boundaries = _candidate_boundaries(item.spoken_text, alignment, protected)
    limits = _limits(item.role, policy)
    offsets: list[tuple[int, int, Literal["sentence", "clause", "fallback", "turn-end"]]] = []
    start = 0
    while True:
        remaining = _metrics(item.spoken_text[start:], policy)
        if _within_hard(remaining, limits, policy):
            offsets.append((start, len(item.spoken_text), "turn-end"))
            break
        boundary = _select_boundary(item.spoken_text, start, boundaries, limits, policy)
        offsets.append((start, boundary.content_end, boundary.reason))
        start = boundary.next_start
        if start >= len(item.spoken_text):
            break

    duplicate_counts: Counter[str] = Counter()
    segments: list[SemanticSegment] = []
    policy_fingerprint = _policy_fingerprint(policy)
    for index, (spoken_start, spoken_end, reason) in enumerate(offsets):
        next_start = offsets[index + 1][0] if index + 1 < len(offsets) else spoken_end
        display_start = alignment.spoken_to_display[spoken_start]
        display_end = alignment.spoken_to_display[spoken_end]
        display_next = alignment.spoken_to_display[next_start]
        spoken_content = item.spoken_text[spoken_start:spoken_end]
        display_content = item.display_text[display_start:display_end]
        occurrence = duplicate_counts[spoken_content]
        duplicate_counts[spoken_content] += 1
        metrics = _metrics(spoken_content, policy)
        source_spans, exact = _source_spans_for_slice(item, display_start, display_end)
        pause_kind: Literal["sentence", "clause", "fallback", "turn"] = (
            "turn" if reason == "turn-end" else reason
        )
        pause_ms = {
            "sentence": policy.sentence_pause_ms,
            "clause": policy.clause_pause_ms,
            "fallback": policy.fallback_pause_ms,
            "turn": policy.same_speaker_turn_pause_ms,
        }[pause_kind]
        before = item.spoken_text[max(0, spoken_start - policy.context_characters) : spoken_start].strip()
        after = item.spoken_text[spoken_end : spoken_end + policy.context_characters].strip()
        segments.append(
            SemanticSegment(
                segment_id=_stable_segment_id(item, spoken_content, occurrence),
                policy_id=policy.policy_id,
                policy_fingerprint=policy_fingerprint,
                source_anchor_id=item.source_anchor_id,
                source_document_sha256=item.source_document_sha256,
                source_block_ids=item.source_block_ids,
                source_spans=source_spans,
                source_spans_exact=exact,
                display_text=display_content,
                spoken_text=spoken_content,
                display_separator_after=item.display_text[display_end:display_next],
                spoken_separator_after=item.spoken_text[spoken_end:next_start],
                language=item.language,
                role=item.role,
                speaker_profile_id=item.speaker_profile_id,
                word_count=metrics.words,
                backend_token_count=metrics.tokens,
                predicted_duration_seconds=metrics.duration,
                boundary_reason=reason,
                pause=PauseIntent(kind=pause_kind, duration_hint_ms=pause_ms),
                context=SegmentContext(before=before, after=after),
            )
        )
    reconstructed_spoken = "".join(
        segment.spoken_text + segment.spoken_separator_after for segment in segments
    )
    reconstructed_display = "".join(
        segment.display_text + segment.display_separator_after for segment in segments
    )
    if reconstructed_spoken != item.spoken_text or reconstructed_display != item.display_text:
        raise SegmentationError("display/spoken alignment failed exact content conservation")
    return segments


def segment_speech(
    inputs: tuple[SegmentationInput, ...],
    *,
    policy: SegmentationPolicy | None = None,
) -> SegmentationResult:
    """Segment hard-bounded turns and report measured distributions/reasons."""

    if not inputs:
        raise SegmentationError("at least one segmentation input is required")
    active_policy = policy or SegmentationPolicy()
    segments: list[SemanticSegment] = []
    turn_ranges: list[tuple[int, int]] = []
    for item in inputs:
        start = len(segments)
        segments.extend(_segment_one(item, active_policy))
        turn_ranges.append((start, len(segments)))

    for input_index, (_, end) in enumerate(turn_ranges):
        final_index = end - 1
        item = inputs[input_index]
        if item.pause_after_ms is not None:
            pause = PauseIntent(kind="explicit", duration_hint_ms=item.pause_after_ms)
        elif input_index + 1 < len(inputs) and inputs[input_index + 1].speaker_profile_id != item.speaker_profile_id:
            pause = PauseIntent(
                kind="speaker-transition",
                duration_hint_ms=active_policy.speaker_transition_pause_ms,
            )
        else:
            pause = PauseIntent(kind="turn", duration_hint_ms=active_policy.same_speaker_turn_pause_ms)
        segments[final_index] = segments[final_index].model_copy(update={"pause": pause})

    # Adjacent metadata spans turn boundaries but is never prepended to synthesis text.
    for index, segment in enumerate(segments):
        before = ""
        after = ""
        if index:
            before = segments[index - 1].spoken_text[-active_policy.context_characters :]
        if index + 1 < len(segments):
            after = segments[index + 1].spoken_text[: active_policy.context_characters]
        segments[index] = segment.model_copy(
            update={"context": SegmentContext(before=before, after=after)}
        )

    words = [segment.word_count for segment in segments]
    durations = [segment.predicted_duration_seconds for segment in segments]
    reasons = Counter(segment.boundary_reason for segment in segments)
    over_target = sum(
        segment.word_count > _limits(segment.role, active_policy).target_words
        for segment in segments
    )
    at_hard = sum(
        segment.word_count == _limits(segment.role, active_policy).max_words
        or segment.backend_token_count == active_policy.max_backend_tokens
        or len(segment.spoken_text) == active_policy.max_characters
        for segment in segments
    )
    report = SegmentationReport(
        policy_id=active_policy.policy_id,
        policy_fingerprint=_policy_fingerprint(active_policy),
        input_turn_count=len(inputs),
        segment_count=len(segments),
        total_words=sum(words),
        total_backend_tokens=sum(segment.backend_token_count for segment in segments),
        total_predicted_duration_seconds=round(sum(durations), 4),
        min_words=min(words),
        median_words=float(median(words)),
        max_words=max(words),
        min_predicted_duration_seconds=min(durations),
        median_predicted_duration_seconds=float(median(durations)),
        max_predicted_duration_seconds=max(durations),
        boundary_reason_counts=dict(sorted(reasons.items())),
        segments_over_target_words=over_target,
        segments_at_hard_limit=at_hard,
    )
    return SegmentationResult(segments=tuple(segments), report=report)
