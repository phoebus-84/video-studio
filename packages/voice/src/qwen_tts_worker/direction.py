"""Stable CustomVoice identity profiles and bounded delivery direction."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from qwen_tts_worker.models.quality import (
    DeliveryDelta,
    FrozenContract,
    SegmentPlan,
    VoiceDirection,
)
from qwen_tts_worker.segmentation import SemanticSegment


DIRECTION_VERSION = "0.1.0"
_IDENTITY_TERMS = (
    " male ", " female ", " man ", " woman ", " boy ", " girl ", " age ",
    " young ", " old ", " voice ", " timbre ", " pitch ", " accent ", " vocal cords ",
)
_DELIVERY_PHRASES = {
    "pace": {
        "slower": "Use a deliberately slower pace",
        "steady": "Use a steady pace",
        "quicker": "Use a slightly quicker pace",
    },
    "articulation": {
        "soft": "Use soft articulation",
        "natural": "Use natural articulation",
        "crisp": "Use crisp articulation",
    },
    "energy": {
        "low": "Keep energy low",
        "medium": "Use medium energy",
        "high": "Use high energy",
    },
    "emotion": {
        "neutral": "Keep the emotion neutral",
        "warm": "Add gentle warmth",
        "joyful": "Sound joyful",
        "curious": "Sound curious",
        "somber": "Use a somber mood",
        "tense": "Use controlled tension",
        "urgent": "Convey urgency",
    },
    "intensity": {
        "restrained": "Keep intensity restrained",
        "moderate": "Use moderate intensity",
        "strong": "Use strong but controlled intensity",
    },
    "intent": {
        "narrate": "Deliver as narration",
        "explain": "Explain clearly",
        "reassure": "Reassure the listener",
        "wonder": "Express wonder",
        "warn": "Deliver a clear warning",
        "question": "Deliver as a genuine question",
        "exclaim": "Deliver as an exclamation",
    },
    "distance": {
        "intimate": "Use an intimate conversational distance",
        "conversational": "Use conversational distance",
        "projected": "Project to a room without shouting",
    },
}


class DirectionError(ValueError):
    """Invalid identity, unsupported backend capability, or contradictory delta."""


class CustomVoiceCapabilities(FrozenContract):
    schema_version: Literal["0.1.0"] = DIRECTION_VERSION
    config_sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    speakers: tuple[str, ...] = Field(..., min_length=1)
    backend_languages: tuple[str, ...] = Field(..., min_length=1)


class CustomVoiceDirectionProfile(FrozenContract):
    """Stable preset identity and non-identity base performance policy."""

    schema_version: Literal["0.1.0"] = DIRECTION_VERSION
    profile_id: str = Field(..., min_length=1, max_length=128)
    profile_revision: str = Field(..., min_length=1, max_length=64)
    character_id: str = Field(..., min_length=1, max_length=128)
    continuity_group: str = Field(..., min_length=1, max_length=128)
    backend_speaker: str = Field(..., min_length=1, max_length=128)
    source_language: str = Field(..., min_length=2, max_length=35)
    backend_language: str = Field(..., min_length=2, max_length=35)
    base_direction_id: str = Field(..., min_length=1, max_length=128)
    base_instruction: str = Field(..., min_length=1, max_length=512)

    @model_validator(mode="after")
    def _base_does_not_redefine_identity(self) -> CustomVoiceDirectionProfile:
        padded = f" {self.base_instruction.casefold()} "
        forbidden = [term.strip() for term in _IDENTITY_TERMS if term in padded]
        if forbidden:
            raise ValueError(
                "base instruction cannot redefine CustomVoice preset identity; "
                f"remove: {', '.join(sorted(forbidden))}"
            )
        return self


class DirectedSegment(FrozenContract):
    schema_version: Literal["0.1.0"] = DIRECTION_VERSION
    semantic_segment: SemanticSegment
    direction_profile: CustomVoiceDirectionProfile
    direction: VoiceDirection
    segment_plan: SegmentPlan


def discover_customvoice_capabilities(model_path: str | Path) -> CustomVoiceCapabilities:
    """Read supported controls from a verified CustomVoice config, never constants."""

    config_path = Path(model_path).expanduser().resolve() / "config.json"
    try:
        raw = config_path.read_bytes()
        config = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise DirectionError(f"cannot read CustomVoice config {config_path}: {exc}") from exc
    if config.get("model_type") != "qwen3_tts" or config.get("tts_model_type") != "custom_voice":
        raise DirectionError("direction profile requires a Qwen3-TTS CustomVoice config")
    talker = config.get("talker_config")
    if not isinstance(talker, dict):
        raise DirectionError("CustomVoice config is missing talker_config")
    speaker_ids = talker.get("spk_id")
    language_ids = talker.get("codec_language_id")
    if not isinstance(speaker_ids, dict) or not speaker_ids:
        raise DirectionError("CustomVoice config exposes no speakers")
    if not isinstance(language_ids, dict) or not language_ids:
        raise DirectionError("CustomVoice config exposes no languages")
    return CustomVoiceCapabilities(
        config_sha256=hashlib.sha256(raw).hexdigest(),
        speakers=tuple(sorted(str(value).casefold() for value in speaker_ids)),
        backend_languages=tuple(
            sorted({"auto", *(str(value).casefold() for value in language_ids)})
        ),
    )


def validate_direction_profile(
    profile: CustomVoiceDirectionProfile,
    capabilities: CustomVoiceCapabilities,
) -> None:
    if profile.backend_speaker.casefold() not in capabilities.speakers:
        raise DirectionError(
            f"unsupported CustomVoice speaker {profile.backend_speaker!r}; "
            f"available: {', '.join(capabilities.speakers)}"
        )
    if profile.backend_language.casefold() not in capabilities.backend_languages:
        raise DirectionError(
            f"unsupported backend language {profile.backend_language!r}; "
            f"available: {', '.join(capabilities.backend_languages)}"
        )


def _delta_values(delta: DeliveryDelta) -> dict[str, str]:
    return {
        key: value
        for key, value in delta.model_dump(mode="json").items()
        if value is not None
    }


def _check_contradictions(base: str, values: dict[str, str]) -> None:
    lower = base.casefold()
    contradictions = (
        (values.get("pace") == "quicker" and any(word in lower for word in ("slow pace", "slowly")), "quicker pace conflicts with slow base direction"),
        (values.get("pace") == "slower" and any(word in lower for word in ("quick pace", "quickly", "fast pace")), "slower pace conflicts with quick base direction"),
        (values.get("emotion") == "joyful" and any(word in lower for word in ("somber", "sad", "mournful")), "joyful emotion conflicts with somber base direction"),
        (values.get("emotion") == "somber" and any(word in lower for word in ("joyful", "cheerful")), "somber emotion conflicts with joyful base direction"),
        (values.get("energy") == "high" and "low energy" in lower, "high energy conflicts with low-energy base direction"),
        (values.get("energy") == "low" and "high energy" in lower, "low energy conflicts with high-energy base direction"),
    )
    failures = [message for condition, message in contradictions if condition]
    if failures:
        raise DirectionError("; ".join(failures))


def compose_direction(
    profile: CustomVoiceDirectionProfile,
    delta: DeliveryDelta | None = None,
) -> VoiceDirection:
    """Compose only enumerated delivery phrases; neutral means the exact base."""

    active_delta = delta or DeliveryDelta()
    values = _delta_values(active_delta)
    _check_contradictions(profile.base_instruction, values)
    instruction = profile.base_instruction.strip()
    if values:
        phrases = [_DELIVERY_PHRASES[key][value] for key, value in values.items()]
        instruction = f"{instruction.rstrip('.')}. {'; '.join(phrases)}."
    if len(instruction) > 768:
        raise DirectionError(
            f"composed direction is {len(instruction)} characters; maximum is 768"
        )
    return VoiceDirection(
        direction_version=DIRECTION_VERSION,
        base_direction_id=profile.base_direction_id,
        base_instruction=profile.base_instruction,
        delta=active_delta,
        composed_instruction=instruction,
    )


def direct_segment(
    segment: SemanticSegment,
    profile: CustomVoiceDirectionProfile,
    *,
    delta: DeliveryDelta | None = None,
    capabilities: CustomVoiceCapabilities | None = None,
) -> DirectedSegment:
    """Bind one semantic segment to a stable identity and final SegmentPlan."""

    if segment.speaker_profile_id != profile.character_id:
        raise DirectionError(
            f"segment speaker {segment.speaker_profile_id!r} does not match "
            f"profile character {profile.character_id!r}"
        )
    if segment.language != profile.source_language:
        raise DirectionError(
            f"segment language {segment.language!r} does not match profile "
            f"language {profile.source_language!r}"
        )
    if capabilities is not None:
        validate_direction_profile(profile, capabilities)
    direction = compose_direction(profile, delta)
    plan = SegmentPlan(
        segment_id=segment.segment_id,
        source_document_sha256=segment.source_document_sha256,
        source_block_ids=segment.source_block_ids,
        source_spans=segment.source_spans,
        preprocessing_version=segment.policy_fingerprint,
        display_text=segment.display_text,
        spoken_text=segment.spoken_text,
        language=segment.language,
        role=segment.role,
        speaker_profile_id=profile.profile_id,
        direction=direction,
        context=segment.context,
        pause_after_ms=segment.pause.duration_hint_ms,
    )
    return DirectedSegment(
        semantic_segment=segment,
        direction_profile=profile,
        direction=direction,
        segment_plan=plan,
    )


def validate_continuity(segments: tuple[DirectedSegment, ...]) -> None:
    """Ensure one continuity group never drifts identity/base direction."""

    groups: dict[str, tuple[str, str, str, str]] = {}
    for segment in segments:
        profile = segment.direction_profile
        identity = (
            profile.profile_id,
            profile.profile_revision,
            profile.backend_speaker,
            profile.base_direction_id,
        )
        previous = groups.setdefault(profile.continuity_group, identity)
        if previous != identity:
            raise DirectionError(
                f"continuity group {profile.continuity_group!r} changes stable "
                "profile revision, preset speaker, or base direction"
            )
