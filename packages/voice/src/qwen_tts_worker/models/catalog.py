"""Pinned Qwen3-TTS MLX model catalogue shared by downloads and runtime diagnostics."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


ModelSizeName = Literal["0.6B", "1.7B"]
ModelProfileName = Literal["custom_voice", "base", "voice_design"]


@dataclass(frozen=True)
class VerifiedFile:
    path: str
    size_bytes: int
    sha256: str


@dataclass(frozen=True)
class ModelSpec:
    size: ModelSizeName
    profile: ModelProfileName
    repository: str
    revision: str
    expected_disk_bytes: int
    verified_files: tuple[VerifiedFile, ...]
    backend: Literal["mlx", "torch"] = "mlx"

    @property
    def directory_name(self) -> str:
        profile_slug = {"custom_voice": "customvoice", "voice_design": "voicedesign", "base": "base"}[self.profile]
        return f"qwen3-tts-{self.size.casefold()}-{profile_slug}-{'8bit' if self.backend == 'mlx' else 'torch'}"

    def path_under(self, root: Path) -> Path:
        return root / self.directory_name


_TOKENIZER = VerifiedFile(
    "speech_tokenizer/model.safetensors",
    682_293_092,
    "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258",
)

MODEL_SPECS: tuple[ModelSpec, ...] = (
    ModelSpec(
        size="0.6B", profile="custom_voice",
        repository="mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit",
        revision="049ef77fe8816b536193c0c25f9a214d17921282",
        expected_disk_bytes=2_000_000_000,
        verified_files=(
            VerifiedFile("model.safetensors", 1_286_743_170, "3bcb2c4a127e6243e81a30b7126c7865f686d3559de4f938e5d3b150c6a9560d"),
            VerifiedFile("config.json", 6_058, "2eea3665564268139c3beb8d497fd3c2e4524e9eed5452836cdf1de96ed3cdbd"),
            _TOKENIZER,
        ),
    ),
    ModelSpec(
        size="1.7B", profile="custom_voice",
        repository="mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
        revision="41d3337e8b7f2843a75841595fc14e4b9a7a4b96",
        expected_disk_bytes=3_200_000_000,
        verified_files=(
            VerifiedFile("model.safetensors", 2_393_308_931, "b696f4bf45f54497b6de758981e76f1410bd68af05a657477dee466b0202df1a"),
            VerifiedFile("config.json", 6_058, "43f29f9ab55cf387bd2ce1d07e9d95a5ca8974fa2fda4e2b45c13ae64aad3bfa"),
            _TOKENIZER,
        ),
    ),
    ModelSpec(
        size="0.6B", profile="base",
        repository="mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
        revision="50f45ef0047cde7e84c2ef04326acb8ada2436a7",
        expected_disk_bytes=2_100_000_000,
        verified_files=(
            VerifiedFile("model.safetensors", 1_304_461_214, "9488e7005cc0cf44f8804eb543668d0763bb1c649ce6f1eddc663519524b3182"),
            VerifiedFile("config.json", 5_522, "b404fb6f99dac6f7a81f3a03af5675b131ecf9936ac75a7c9d75e54044600044"),
            _TOKENIZER,
        ),
    ),
    ModelSpec(
        size="1.7B", profile="base",
        repository="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit",
        revision="e7dd0585652209fa0d7783659aad4e8a324de11c",
        expected_disk_bytes=3_300_000_000,
        verified_files=(
            VerifiedFile("model.safetensors", 2_417_320_525, "b965c581ccf6aa852a4124feeb7a8a111542ee7b213139368b4cc7ba7fd4728b"),
            VerifiedFile("config.json", 5_522, "b14fba6bfd391968876248b843b095696b0188187a3d774a3bddc32544d15627"),
            _TOKENIZER,
        ),
    ),
    ModelSpec(
        size="1.7B", profile="voice_design",
        repository="mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",
        revision="f90d617701d9f7f4ca499291e0b57f2b3c2fd2ee",
        expected_disk_bytes=3_200_000_000,
        verified_files=(
            VerifiedFile("model.safetensors", 2_393_308_931, "1a84179d87c972353ccdd9b48f3c4422509b3d1b11030d32358312fb0f3800d7"),
            VerifiedFile("config.json", 5_437, "b91c47798e77e259e6b86987e48d7a5eca8e703205e00afb63fe08ec5251f983"),
            _TOKENIZER,
        ),
    ),
)


TORCH_MODEL_SPECS: tuple[ModelSpec, ...] = tuple(
    ModelSpec(**{**item, "verified_files": tuple(VerifiedFile(**file) for file in item["verified_files"])}, backend="torch")
    for item in json.loads(Path(__file__).with_name("torch-catalog.json").read_text(encoding="utf-8"))
)


def model_specs(backend: str | None = None) -> tuple[ModelSpec, ...]:
    from qwen_tts_worker.backends import backend_name

    return MODEL_SPECS if backend_name(backend) == "mlx" else TORCH_MODEL_SPECS


def get_model_spec(size: str, profile: str, *, backend: str | None = None) -> ModelSpec:
    for spec in model_specs(backend):
        if spec.size == size and spec.profile == profile:
            return spec
    available = ", ".join(f"{item.size}/{item.profile}" for item in MODEL_SPECS)
    raise KeyError(f"unsupported model {size}/{profile}; available: {available}")
