"""Deterministic adapters from legacy scripts to source-mapped structural blocks."""

from __future__ import annotations

import hashlib
import json
import re
from enum import Enum
from pathlib import Path
from typing import Literal

from pydantic import Field

from qwen_tts_worker.models.quality import (
    FrozenContract,
    SourceDocument,
    SourceFormat,
    SourceSpan,
    SpeechRole,
    SpokenBlock,
)


INGESTION_VERSION = "0.1.0"
_NARRATION_LABELS = {"narration", "narrator", "voiceover", "voice-over"}
_LABEL = re.compile(r"^(?P<indent>\s*)\*\*(?P<label>[^*]+?)\*\*\s*:?\s*(?P<value>.*)$")
_PLAIN_LABEL = re.compile(
    r"^(?P<indent>\s*)(?P<label>[A-Za-z][A-Za-z .'-]{0,64}):\s+(?P<value>.+?)\s*$"
)
_BRACKET_DIRECTION = re.compile(r"^\s*\[(?:image|visual|animation|audio|sfx)\s*:", re.IGNORECASE)
_HEADING = re.compile(r"^(?P<marks>#{1,6})\s+(?P<title>.+?)\s*$")
_SCENE_ID = re.compile(r"\b(?:scene\s*)?(s?\d+)\b", re.IGNORECASE)
_FENCE = re.compile(r"^\s*(```|~~~)")


class IngestionError(ValueError):
    """An actionable source decoding or shape failure."""


class StructuralKind(str, Enum):
    """Conservative Markdown/JSON structural classification."""

    HEADING = "heading"
    SEPARATOR = "separator"
    METADATA = "metadata"
    DIRECTION = "direction"
    CODE = "code"
    COMMENT = "comment"
    SPOKEN = "spoken"
    UNLABELED = "unlabeled"


class StructuralBlock(FrozenContract):
    """One source-mapped block, including material excluded from speech."""

    block_id: str = Field(..., min_length=1, max_length=256)
    source_document_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    source_span: SourceSpan
    kind: StructuralKind
    text: str
    scene_id: str | None = Field(default=None, max_length=128)
    label: str | None = Field(default=None, max_length=128)


class IngestionDiagnostic(FrozenContract):
    """Reviewable parser warning/error tied to source when possible."""

    severity: Literal["warning", "error"]
    code: str = Field(..., min_length=1, max_length=128)
    message: str = Field(..., min_length=1, max_length=1000)
    source_span: SourceSpan | None = None


class IngestionResult(FrozenContract):
    """Exact source identity plus deterministic structural interpretation."""

    schema_version: Literal["0.1.0"] = INGESTION_VERSION
    ingestion_version: Literal["0.1.0"] = INGESTION_VERSION
    source: SourceDocument
    raw_bytes: bytes = Field(repr=False)
    raw_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    encoding: Literal["utf-8"] = "utf-8"
    unicode_policy: Literal["preserve"] = "preserve"
    line_ending: Literal["lf", "crlf", "cr", "mixed", "none"]
    blocks: tuple[StructuralBlock, ...]
    spoken_blocks: tuple[SpokenBlock, ...]
    diagnostics: tuple[IngestionDiagnostic, ...] = ()


def _decode_utf8(raw: bytes, source_id: str) -> tuple[str, bool]:
    bom = raw.startswith(b"\xef\xbb\xbf")
    payload = raw[3:] if bom else raw
    try:
        return payload.decode("utf-8", errors="strict"), bom
    except UnicodeDecodeError as exc:
        bad = raw[exc.start : exc.end].hex() or "unknown"
        raise IngestionError(
            f"{source_id}: invalid UTF-8 at byte {exc.start} (bytes {bad}); "
            "convert the source to UTF-8 without lossy replacement"
        ) from exc


def _line_ending(text: str) -> Literal["lf", "crlf", "cr", "mixed", "none"]:
    crlf = text.count("\r\n")
    without_crlf = text.replace("\r\n", "")
    lf = without_crlf.count("\n")
    cr = without_crlf.count("\r")
    kinds = sum(bool(value) for value in (crlf, lf, cr))
    if kinds == 0:
        return "none"
    if kinds > 1:
        return "mixed"
    return "crlf" if crlf else "lf" if lf else "cr"


def _document(
    *,
    text: str,
    source_id: str,
    revision: str,
    source_format: SourceFormat,
    language: str,
) -> SourceDocument:
    return SourceDocument(
        source_id=source_id,
        revision=revision,
        content_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        format=source_format,
        language=language,
        text=text,
    )


def _stable_block_id(source_hash: str, identity: str, index: int, text: str) -> str:
    material = f"{source_hash}\0{identity}\0{index}\0{text}".encode("utf-8")
    suffix = hashlib.sha256(material).hexdigest()[:12]
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "-", identity).strip("-") or "block"
    return f"{safe}.{index}.{suffix}"


def _source_span(start: int, end: int) -> SourceSpan:
    if end <= start:
        end = start + 1
    return SourceSpan(start=start, end=end)


def _line_ranges(text: str) -> list[tuple[int, int, str]]:
    ranges: list[tuple[int, int, str]] = []
    cursor = 0
    for line in text.splitlines(keepends=True):
        end = cursor + len(line)
        content_end = end
        while content_end > cursor and text[content_end - 1] in "\r\n":
            content_end -= 1
        ranges.append((cursor, content_end, text[cursor:content_end]))
        cursor = end
    if cursor < len(text) or not ranges:
        ranges.append((cursor, len(text), text[cursor:]))
    return ranges


def ingest_markdown_bytes(
    raw: bytes,
    *,
    source_id: str,
    revision: str | None = None,
    language: str = "en-US",
) -> IngestionResult:
    """Parse supported script Markdown without treating directions as speech."""

    text, had_bom = _decode_utf8(raw, source_id)
    raw_hash = hashlib.sha256(raw).hexdigest()
    revision = revision or f"sha256:{raw_hash}"
    document = _document(
        text=text,
        source_id=source_id,
        revision=revision,
        source_format=SourceFormat.MARKDOWN_SCRIPT,
        language=language,
    )
    structural: list[StructuralBlock] = []
    spoken: list[SpokenBlock] = []
    diagnostics: list[IngestionDiagnostic] = []
    current_scene: str | None = None
    production_notes = False
    fence_marker: str | None = None
    fence_start: int | None = None

    for index, (start, end, line) in enumerate(_line_ranges(text), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        span = _source_span(start, end)
        heading = _HEADING.match(line)
        fence = _FENCE.match(line)
        kind: StructuralKind
        label: str | None = None
        block_text = stripped

        if fence_marker is not None:
            kind = StructuralKind.CODE
            if fence and fence.group(1) == fence_marker:
                fence_marker = None
                fence_start = None
        elif fence:
            kind = StructuralKind.CODE
            fence_marker = fence.group(1)
            fence_start = start
        elif stripped.startswith("<!--"):
            kind = StructuralKind.COMMENT
            if "-->" not in stripped:
                diagnostics.append(
                    IngestionDiagnostic(
                        severity="warning",
                        code="markdown.multiline-comment",
                        message="Multiline HTML comments are excluded line-by-line; review source structure.",
                        source_span=span,
                    )
                )
        elif heading:
            title = heading.group("title")
            scene_match = _SCENE_ID.search(title)
            current_scene = scene_match.group(1).lower() if scene_match else current_scene
            production_notes = title.strip().lower() in {"production notes", "notes"}
            kind = StructuralKind.HEADING
            block_text = title
        elif stripped in {"---", "***", "___"}:
            kind = StructuralKind.SEPARATOR
        else:
            bold_label = _LABEL.match(line)
            plain_label = _PLAIN_LABEL.match(line)
            labeled = bold_label or plain_label
            if _BRACKET_DIRECTION.match(line):
                kind = StructuralKind.DIRECTION
                label = "image"
            elif labeled:
                label = labeled.group("label").strip().rstrip(":").strip("[]").lower()
                value = labeled.group("value")
                value_start = start + labeled.start("value")
                is_plain_character = (
                    plain_label is not None
                    and current_scene is not None
                    and not production_notes
                    and label not in {"role", "tone", "duration", "duration target", "audience", "style"}
                )
                is_spoken = (
                    (label in _NARRATION_LABELS or is_plain_character)
                    and value.strip()
                    and not production_notes
                )
                if is_spoken:
                    value_leading = len(value) - len(value.lstrip())
                    value_trailing = len(value.rstrip())
                    spoken_start = value_start + value_leading
                    spoken_end = value_start + value_trailing
                    display = text[spoken_start:spoken_end]
                    spoken_span = _source_span(spoken_start, spoken_end)
                    block_id = _stable_block_id(
                        document.content_sha256,
                        current_scene or "markdown",
                        len(spoken) + 1,
                        display,
                    )
                    kind = StructuralKind.SPOKEN
                    block_text = display
                    span = spoken_span
                    spoken.append(
                        SpokenBlock(
                            block_id=block_id,
                            source_document_sha256=document.content_sha256,
                            source_spans=(spoken_span,),
                            role=(
                                SpeechRole.NARRATOR
                                if label in _NARRATION_LABELS
                                else SpeechRole.DIALOGUE
                            ),
                            speaker=(
                                "unresolved"
                                if label in _NARRATION_LABELS
                                else re.sub(r"[^a-z0-9]+", "-", label).strip("-")
                            ),
                            display_text=display,
                            spoken_text=display,
                            language=language,
                        )
                    )
                else:
                    kind = (
                        StructuralKind.DIRECTION
                        if label in {"visual", "image", "animation", "audio", "sfx"}
                        else StructuralKind.METADATA
                    )
                    if label in _NARRATION_LABELS and not value.strip():
                        diagnostics.append(
                            IngestionDiagnostic(
                                severity="error",
                                code="markdown.empty-narration",
                                message=f"Narration label at line {index} has no spoken text.",
                                source_span=span,
                            )
                        )
            elif production_notes or stripped.startswith(("- ", "* ")):
                kind = StructuralKind.METADATA
            else:
                kind = StructuralKind.UNLABELED
                diagnostics.append(
                    IngestionDiagnostic(
                        severity="warning",
                        code="markdown.unlabeled-prose",
                        message=(
                            f"Unlabeled prose at line {index} was excluded from speech; "
                            "label it as **Narration**, **Narrator:**, or a character name to include it."
                        ),
                        source_span=span,
                    )
                )

        structural_id = (
            spoken[-1].block_id
            if kind == StructuralKind.SPOKEN
            else _stable_block_id(
                document.content_sha256,
                current_scene or kind.value,
                index,
                block_text,
            )
        )
        structural.append(
            StructuralBlock(
                block_id=structural_id,
                source_document_sha256=document.content_sha256,
                source_span=span,
                kind=kind,
                text=block_text,
                scene_id=current_scene,
                label=label,
            )
        )

    if fence_marker is not None:
        diagnostics.append(
            IngestionDiagnostic(
                severity="error",
                code="markdown.unclosed-fence",
                message=f"Unclosed {fence_marker} code fence; content was excluded from speech.",
                source_span=_source_span(fence_start or 0, len(text)),
            )
        )
    if had_bom:
        diagnostics.append(
            IngestionDiagnostic(
                severity="warning",
                code="encoding.utf8-bom",
                message="UTF-8 BOM was removed before character offsets were assigned.",
            )
        )
    if not spoken:
        diagnostics.append(
            IngestionDiagnostic(
                severity="error",
                code="source.no-spoken-blocks",
                message="No labeled narration was found; no text will be synthesized.",
            )
        )
    return IngestionResult(
        source=document,
        raw_bytes=raw,
        raw_sha256=raw_hash,
        line_ending=_line_ending(text),
        blocks=tuple(structural),
        spoken_blocks=tuple(spoken),
        diagnostics=tuple(diagnostics),
    )


def _json_string_tokens(text: str) -> list[tuple[int, int, str]]:
    tokens: list[tuple[int, int, str]] = []
    index = 0
    while index < len(text):
        if text[index] != '"':
            index += 1
            continue
        start = index
        index += 1
        escaped = False
        while index < len(text):
            character = text[index]
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                end = index + 1
                try:
                    value = json.loads(text[start:end])
                except json.JSONDecodeError as exc:
                    raise IngestionError(
                        f"invalid JSON string token at character {start}: {exc.msg}"
                    ) from exc
                tokens.append((start, end, value))
                index = end
                break
            index += 1
        else:
            raise IngestionError(f"unterminated JSON string at character {start}")
    return tokens


def _json_text_value_spans(text: str) -> list[SourceSpan]:
    tokens = _json_string_tokens(text)
    spans: list[SourceSpan] = []
    for token_index, (start, end, value) in enumerate(tokens[:-1]):
        if value != "text":
            continue
        next_start, next_end, _ = tokens[token_index + 1]
        between = text[end:next_start]
        if re.fullmatch(r"\s*:\s*", between):
            spans.append(_source_span(next_start + 1, next_end - 1))
    return spans


def ingest_narration_json_bytes(
    raw: bytes,
    *,
    source_id: str,
    revision: str | None = None,
    language: str = "en-US",
) -> IngestionResult:
    """Parse the supported legacy list-of-scenes narration JSON shape."""

    text, had_bom = _decode_utf8(raw, source_id)
    raw_hash = hashlib.sha256(raw).hexdigest()
    revision = revision or f"sha256:{raw_hash}"
    document = _document(
        text=text,
        source_id=source_id,
        revision=revision,
        source_format=SourceFormat.NARRATION_SCRIPT_JSON,
        language=language,
    )
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise IngestionError(
            f"{source_id}: invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc
    if not isinstance(payload, list):
        raise IngestionError(
            f"{source_id}: narration-script.json must contain a top-level array of scenes"
        )
    spans = _json_text_value_spans(text)
    if len(spans) != len(payload):
        raise IngestionError(
            f"{source_id}: expected one JSON text field per scene; found {len(payload)} scenes and {len(spans)} source spans"
        )

    structural: list[StructuralBlock] = []
    spoken: list[SpokenBlock] = []
    diagnostics: list[IngestionDiagnostic] = []
    seen_ids: set[str] = set()
    for index, (item, span) in enumerate(zip(payload, spans, strict=True), start=1):
        if not isinstance(item, dict):
            raise IngestionError(f"{source_id}: scene {index} must be an object")
        scene_id = item.get("id")
        value = item.get("text")
        if not isinstance(scene_id, str) or not scene_id.strip():
            raise IngestionError(f"{source_id}: scene {index} requires a non-empty string id")
        if scene_id in seen_ids:
            raise IngestionError(f"{source_id}: duplicate scene id {scene_id!r}")
        seen_ids.add(scene_id)
        if not isinstance(value, str) or not value.strip():
            raise IngestionError(f"{source_id}: scene {scene_id!r} requires non-empty text")
        block_id = _stable_block_id(
            document.content_sha256, scene_id, index, value
        )
        structural.append(
            StructuralBlock(
                block_id=block_id,
                source_document_sha256=document.content_sha256,
                source_span=span,
                kind=StructuralKind.SPOKEN,
                text=value,
                scene_id=scene_id,
                label="text",
            )
        )
        spoken.append(
            SpokenBlock(
                block_id=block_id,
                source_document_sha256=document.content_sha256,
                source_spans=(span,),
                role=SpeechRole.NARRATOR,
                speaker="unresolved",
                display_text=value,
                spoken_text=value,
                language=language,
            )
        )
    if had_bom:
        diagnostics.append(
            IngestionDiagnostic(
                severity="warning",
                code="encoding.utf8-bom",
                message="UTF-8 BOM was removed before character offsets were assigned.",
            )
        )
    return IngestionResult(
        source=document,
        raw_bytes=raw,
        raw_sha256=raw_hash,
        line_ending=_line_ending(text),
        blocks=tuple(structural),
        spoken_blocks=tuple(spoken),
        diagnostics=tuple(diagnostics),
    )


def ingest_script(
    path: str | Path,
    *,
    source_id: str | None = None,
    revision: str | None = None,
    language: str = "en-US",
) -> IngestionResult:
    """Dispatch a supported script path to the corresponding additive adapter."""

    source_path = Path(path)
    try:
        raw = source_path.read_bytes()
    except OSError as exc:
        raise IngestionError(f"cannot read {source_path}: {exc}") from exc
    identity = source_id or source_path.as_posix()
    if source_path.name == "narration-script.json":
        return ingest_narration_json_bytes(
            raw, source_id=identity, revision=revision, language=language
        )
    if source_path.name == "script.md" or source_path.suffix.lower() == ".md":
        return ingest_markdown_bytes(
            raw, source_id=identity, revision=revision, language=language
        )
    raise IngestionError(
        f"unsupported script format for {source_path}; expected script.md or narration-script.json"
    )
