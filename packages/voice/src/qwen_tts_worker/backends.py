"""Local inference selection. No model downloads, ML imports, or fallback at import time.

MLX is preferred on Apple Silicon. The official Qwen PyTorch implementation
provides the portable CPU/CUDA/ROCm path. Explicit device failures are errors,
never a change of provider, checkpoint, or a successful silent WAV.
"""
from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import os
import platform
import re
import threading
import wave
from functools import wraps
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

GENERATION_LOCK = threading.RLock()


def configured_environment() -> dict[str, str]:
    from dotenv import dotenv_values

    return {**{key: value for key, value in dotenv_values('.env').items() if value is not None}, **os.environ}


def backend_name(value: str | None = None) -> str:
    selected = (value or configured_environment().get("QTW_BACKEND", "auto")).strip().lower()
    if selected == "auto":
        return "mlx" if platform.system() == "Darwin" and platform.machine().lower() in {"arm64", "aarch64"} else "torch"
    if selected not in {"mlx", "torch"}:
        raise ValueError("QTW_BACKEND must be auto, mlx, or torch")
    return selected


def _version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not-installed"


@dataclass(frozen=True)
class RuntimePlan:
    backend: str
    device: str
    dtype: str
    attention: str
    cpu_threads: int | None
    runtime_version: str
    engine_version: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def resolve_runtime(environ: Mapping[str, str] | None = None, *, torch_module: Any = None) -> RuntimePlan:
    env = configured_environment() if environ is None else environ
    backend = backend_name(env.get("QTW_BACKEND", "auto"))
    device = env.get("QTW_DEVICE", "auto").strip().lower()
    dtype = env.get("QTW_DTYPE", "auto").strip().lower()
    attention = env.get("QTW_ATTENTION", "sdpa").strip().lower()
    raw_threads = env.get("QTW_CPU_THREADS")
    threads = int(raw_threads) if raw_threads else None
    if threads is not None and not 1 <= threads <= 1024:
        raise ValueError("QTW_CPU_THREADS must be between 1 and 1024")
    if backend == "mlx":
        if platform.system() != "Darwin" or platform.machine().lower() not in {"arm64", "aarch64"}:
            raise RuntimeError("MLX requires Apple Silicon; select QTW_BACKEND=torch for CPU/CUDA/ROCm")
        if device not in {"auto", "metal"} or dtype != "auto" or attention != "sdpa" or threads is not None:
            raise ValueError("MLX owns device, quantization and attention; Torch tuning options cannot be used with MLX")
        return RuntimePlan("mlx", "metal", "checkpoint", "mlx", None, _version("mlx"), _version("mlx-audio"))
    if torch_module is None:
        try:
            import torch as torch_module
        except ImportError as exc:
            raise RuntimeError("PyTorch is unavailable; install the appropriate CPU/CUDA/ROCm PyTorch wheels and qwen-tts-worker[torch]") from exc
    torch = torch_module
    if device == "auto":
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
    if device == "cuda":
        device = "cuda:0"
    if device != "cpu" and not re.fullmatch(r"cuda:\d+", device):
        raise ValueError("QTW_DEVICE must be auto, cpu, cuda, or cuda:N (ROCm also uses cuda:N in PyTorch)")
    if device.startswith("cuda:"):
        index = int(device.split(":")[1])
        if not torch.cuda.is_available() or index >= torch.cuda.device_count():
            raise RuntimeError(f"Requested GPU {device} is unavailable; no CPU fallback was performed")
        with torch.cuda.device(index):
            bf16 = torch.cuda.is_bf16_supported(including_emulation=False)
        if dtype == "auto":
            dtype = "bfloat16" if bf16 else "float16"
        if dtype == "bfloat16" and not bf16:
            raise ValueError(f"{device} does not support bfloat16; use float16 or float32")
        if threads is not None:
            raise ValueError("QTW_CPU_THREADS applies only to QTW_DEVICE=cpu")
    elif dtype == "auto":
        dtype = "float32"  # CPU fp16 support/performance is not portable.
    if dtype not in {"float32", "float16", "bfloat16"}:
        raise ValueError("QTW_DTYPE must be auto, float32, float16, or bfloat16")
    if device == "cpu" and dtype == "float16":
        raise ValueError("CPU float16 is not a supported portable path; use float32 or explicitly benchmark bfloat16")
    if attention not in {"sdpa", "eager", "flash_attention_2"}:
        raise ValueError("QTW_ATTENTION must be sdpa, eager, or flash_attention_2")
    if attention == "flash_attention_2":
        if device == "cpu" or getattr(torch.version, "hip", None) or dtype == "float32":
            raise ValueError("flash_attention_2 requires an NVIDIA CUDA GPU and float16/bfloat16")
        if torch.cuda.get_device_capability(int(device.split(":")[1])) < (8, 0):
            raise ValueError("flash_attention_2 requires an Ampere-or-newer NVIDIA GPU")
        if importlib.util.find_spec("flash_attn") is None:
            raise RuntimeError("flash_attention_2 was requested but flash-attn is not installed")
    if device == "cpu" and threads is None:
        threads = torch.get_num_threads()
    return RuntimePlan("torch", device, dtype, attention, threads, str(torch.__version__), _version("qwen-tts"))


def runtime_key() -> str:
    """Cheap context for warm-cache identity; never initializes a GPU."""
    env = configured_environment()
    material = {key: env.get(key) for key in (
        "QTW_BACKEND", "QTW_DEVICE", "QTW_DTYPE", "QTW_ATTENTION", "QTW_CPU_THREADS")}
    backend = backend_name()
    material.update(loaded_runtime(None) if backend == 'mlx' else resolve_runtime().as_dict())
    return json.dumps(material, sort_keys=True, separators=(",", ":"))


def loaded_runtime(model: Any) -> dict[str, Any]:
    if isinstance(model, TorchModel):
        return model.plan.as_dict()
    return RuntimePlan("mlx", "metal", "checkpoint", "mlx", None, _version("mlx"), _version("mlx-audio")).as_dict()


def serialized_generation(function):
    @wraps(function)
    def run(*args, **kwargs):
        with GENERATION_LOCK:
            return function(*args, **kwargs)
    return run


class TorchModel:
    """Warm official Qwen model with the same file-output boundary as MLX."""

    def __init__(self, model: Any, plan: RuntimePlan, torch_module: Any) -> None:
        self.model, self.plan, self.torch = model, plan, torch_module

    def generate_audio(
        self, *, text: str, seed: int, output_path: str, file_prefix: str,
        lang_code: str, temperature: float, top_k: int, top_p: float,
        repetition_penalty: float, max_tokens: int, voice: str | None = None,
        instruct: str | None = None, ref_audio: str | None = None,
        ref_text: str | None = None, **output_options: Any,
    ) -> None:
        import numpy as np

        expected = {"speed": 1.0, "split_pattern": None, "audio_format": "wav", "join_audio": False,
                    "play": False, "verbose": False, "stream": False}
        for key, value in output_options.items():
            if key not in expected or value != expected[key]:
                raise ValueError(f"Unsupported portable generation option: {key}={value!r}")
        controls = dict(do_sample=True, temperature=temperature, top_k=top_k, top_p=top_p,
                        repetition_penalty=repetition_penalty, max_new_tokens=max_tokens,
                        subtalker_dosample=True, subtalker_temperature=temperature,
                        subtalker_top_k=top_k, subtalker_top_p=top_p)
        torch = self.torch
        gpu = self.plan.device.startswith("cuda:")
        devices = [int(self.plan.device.split(":")[1])] if gpu else []
        # The lock covers seeding AND generation. fork_rng restores the selected
        # device's and CPU's RNGs rather than disturbing unrelated users.
        from contextlib import nullcontext
        with GENERATION_LOCK, torch.random.fork_rng(devices=devices), torch.inference_mode():
            torch.random.default_generator.manual_seed(seed)
            with torch.cuda.device(devices[0]) if gpu else nullcontext():
                if gpu:
                    torch.cuda.manual_seed(seed)
                if ref_audio is not None:
                    if not ref_text:
                        raise ValueError("Clone synthesis requires the enrolled reference transcript")
                    wavs, rate = self.model.generate_voice_clone(
                        text=text, language=lang_code, ref_audio=ref_audio,
                        ref_text=ref_text, x_vector_only_mode=False, **controls)
                else:
                    wavs, rate = self.model.generate_custom_voice(
                        text=text, language=lang_code, speaker=voice,
                        instruct=instruct or "", **controls)
        if rate != 24000 or len(wavs) != 1:
            raise RuntimeError("Qwen must return exactly one 24000 Hz waveform")
        audio = np.asarray(wavs[0])
        if audio.ndim != 1 or not audio.size or not np.isfinite(audio).all():
            raise RuntimeError("Qwen returned empty, non-mono, or non-finite audio")
        pcm = np.rint(np.clip(audio, -1, 1) * 32767).astype("<i2")
        destination = Path(output_path) / (file_prefix + ".wav")
        with wave.open(str(destination), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(pcm.tobytes())

    def close(self) -> None:
        import gc

        self.model = None
        gc.collect()
        if self.plan.device.startswith("cuda:"):
            with self.torch.cuda.device(int(self.plan.device.split(":")[1])):
                self.torch.cuda.empty_cache()


def load_model(path: str) -> Any:
    plan = resolve_runtime()
    if plan.backend == "mlx":
        from mlx_audio.tts.utils import load_model as mlx_load
        return mlx_load(model_path=path)
    config = json.loads((Path(path) / "config.json").read_text(encoding="utf-8"))
    if "quantization" in config:
        raise ValueError("MLX-quantized weights are not PyTorch checkpoints; install with QTW_BACKEND=torch")
    import torch
    from qwen_tts import Qwen3TTSModel
    if plan.cpu_threads is not None:
        torch.set_num_threads(plan.cpu_threads)
    model = Qwen3TTSModel.from_pretrained(
        path, device_map=plan.device, dtype=getattr(torch, plan.dtype),
        attn_implementation=plan.attention, local_files_only=True,
    )
    model.model.eval()
    return TorchModel(model, plan, torch)


def generate_audio(**kwargs: Any) -> None:
    model = kwargs.pop("model")
    seed = kwargs.pop("seed", None)
    if isinstance(model, TorchModel):
        if seed is None:
            raise ValueError("Portable generation requires an explicit seed")
        return model.generate_audio(seed=seed, **kwargs)
    from mlx_audio.tts.generate import generate_audio as mlx_generate
    return mlx_generate(model=model, **kwargs)
