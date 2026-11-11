"""Portable runtime policy and real adapter boundary, without GPUs or downloads."""
from __future__ import annotations

import hashlib
import json
import sys
import threading
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from qwen_tts_worker import backends
from qwen_tts_worker.backends import RuntimePlan, TorchModel, backend_name, resolve_runtime
from qwen_tts_worker.model_lifecycle import ModelLifecycleManager
from qwen_tts_worker.models.catalog import MODEL_SPECS, TORCH_MODEL_SPECS, get_model_spec
from qwen_tts_worker.routes.synthesis import SynthesizeRequest, inspect_customvoice_model, synthesize_with_qwen, validate_live_wav


def fake_torch(*, gpu=False, bf16=False, hip=None):
    return SimpleNamespace(
        __version__="test-torch",
        version=SimpleNamespace(hip=hip),
        cuda=SimpleNamespace(is_available=lambda: gpu, device_count=lambda: 2 if gpu else 0,
                             device=lambda _: nullcontext(), is_bf16_supported=lambda **_: bf16,
                             get_device_capability=lambda _: (8, 0),
                             manual_seed=Mock(), empty_cache=Mock()),
        get_num_threads=lambda: 4,
        random=SimpleNamespace(fork_rng=Mock(side_effect=lambda **_: nullcontext()),
                               default_generator=SimpleNamespace(manual_seed=Mock())),
        inference_mode=lambda: nullcontext(),
    )


def plan(env=None, **torch_options):
    return resolve_runtime({"QTW_BACKEND": "torch", **(env or {})}, torch_module=fake_torch(**torch_options))


@pytest.mark.parametrize("system,machine,expected", [
    ("Darwin", "arm64", "mlx"), ("Darwin", "x86_64", "torch"),
    ("Linux", "x86_64", "torch"), ("Windows", "AMD64", "torch"), ("Linux", "aarch64", "torch"),
])
def test_platform_selection(system, machine, expected, monkeypatch):
    monkeypatch.setattr(backends.platform, "system", lambda: system)
    monkeypatch.setattr(backends.platform, "machine", lambda: machine)
    assert backend_name("auto") == expected


def test_cpu_defaults_are_portable_and_not_half_precision():
    selected = plan()
    assert (selected.device, selected.dtype, selected.attention, selected.cpu_threads) == ("cpu", "float32", "sdpa", 4)


@pytest.mark.parametrize("bf16,dtype", [(True,"bfloat16"), (False,"float16")])
def test_cuda_auto_precision(bf16, dtype):
    selected = plan(gpu=True, bf16=bf16)
    assert selected.device == "cuda:0" and selected.dtype == dtype


def test_rocm_uses_torch_cuda_api_without_changing_provider():
    selected = plan({"QTW_DEVICE": "cuda:1"}, gpu=True, bf16=True, hip="6.4")
    assert selected.device == "cuda:1"


@pytest.mark.parametrize("env,message", [
    ({"QTW_DEVICE":"cuda:0"}, "unavailable"),
    ({"QTW_DEVICE":"vulkan"}, "QTW_DEVICE"),
    ({"QTW_DTYPE":"float16"}, "CPU float16"),
    ({"QTW_ATTENTION":"flash_attention_2"}, "requires an NVIDIA"),
    ({"QTW_CPU_THREADS":"0"}, "QTW_CPU_THREADS"),
    ({"QTW_DTYPE":"int4"}, "QTW_DTYPE"),
    ({"QTW_ATTENTION":"magic"}, "QTW_ATTENTION"),
])
def test_bad_configuration_fails_without_fallback(env, message):
    with pytest.raises((RuntimeError, ValueError), match=message):
        plan(env)


def test_unavailable_gpu_index_and_precision_are_rejected():
    with pytest.raises(RuntimeError, match="unavailable"):
        plan({"QTW_DEVICE":"cuda:9"}, gpu=True)
    with pytest.raises(ValueError, match="bfloat16"):
        plan({"QTW_DTYPE":"bfloat16"}, gpu=True)


def test_flash_attention_is_explicit_and_missing_install_is_an_error(monkeypatch):
    monkeypatch.setattr(backends.importlib.util, "find_spec", lambda _: None)
    with pytest.raises(RuntimeError, match="not installed"):
        plan({"QTW_ATTENTION":"flash_attention_2"}, gpu=True)
    with pytest.raises(ValueError, match="NVIDIA"):
        plan({"QTW_ATTENTION":"flash_attention_2"}, gpu=True, hip="6.4")


def test_mlx_rejects_non_apple_hardware_and_torch_tuning(monkeypatch):
    monkeypatch.setattr(backends.platform, "system", lambda: "Linux")
    with pytest.raises(RuntimeError, match="Apple Silicon"):
        resolve_runtime({"QTW_BACKEND":"mlx"})
    monkeypatch.setattr(backends.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(backends.platform, "machine", lambda: "arm64")
    with pytest.raises(ValueError, match="MLX owns"):
        resolve_runtime({"QTW_BACKEND":"mlx", "QTW_DEVICE":"cpu"})


def test_missing_torch_is_actionable(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", None)
    with pytest.raises(RuntimeError, match="PyTorch is unavailable"):
        resolve_runtime({"QTW_BACKEND":"torch"})


def test_catalogues_are_pinned_and_do_not_alias_quantized_weights(monkeypatch):
    for specs in (MODEL_SPECS, TORCH_MODEL_SPECS):
        assert len(specs) == 5
        for spec in specs:
            assert len(spec.revision) == 40
            assert all(len(file.sha256) == 64 for file in spec.verified_files)
    monkeypatch.setenv("QTW_BACKEND", "torch")
    official = get_model_spec("0.6B", "custom_voice")
    assert official.repository.startswith("Qwen/")
    assert official.directory_name.endswith("-torch")
    assert official.directory_name != get_model_spec("0.6B", "custom_voice", backend="mlx").directory_name


def test_explicit_registry_backend_does_not_follow_process_default(tmp_path):
    from qwen_tts_worker.models.registry import ModelRegistry, ModelEntry, ModelSize, ModelProfile
    registry = ModelRegistry(tmp_path, backend="torch")
    status = registry.validate_directory(ModelEntry(ModelSize.S_0_6B, ModelProfile.CUSTOM_VOICE))
    assert status.repository.startswith("Qwen/") and status.path.name.endswith("-torch")


def test_loader_uses_local_official_checkpoint_and_explicit_options(tmp_path,monkeypatch):
    import sys
    torch = fake_torch()
    torch.float32 = "float32"
    torch.set_num_threads = Mock()
    engine = SimpleNamespace(model=SimpleNamespace(eval=Mock()))
    load = Mock(return_value=engine)
    monkeypatch.setenv("QTW_BACKEND","torch")
    monkeypatch.setenv("QTW_DEVICE","cpu")
    monkeypatch.setitem(sys.modules,"torch",torch)
    monkeypatch.setitem(sys.modules,"qwen_tts",SimpleNamespace(Qwen3TTSModel=SimpleNamespace(from_pretrained=load)))
    (tmp_path/"config.json").write_text("{}")
    model = backends.load_model(str(tmp_path))
    assert isinstance(model,TorchModel)
    assert load.call_args.kwargs == {"device_map":"cpu","dtype":"float32","attn_implementation":"sdpa","local_files_only":True}
    engine.model.eval.assert_called_once()
    (tmp_path/"config.json").write_text('{"quantization":{"bits":8}}')
    with pytest.raises(ValueError,match="MLX-quantized"):
        backends.load_model(str(tmp_path))


def runtime_model(engine, torch=None):
    return TorchModel(engine, RuntimePlan("torch","cpu","float32","sdpa",4,"test-torch","test-qwen"), torch or fake_torch())


def test_official_synthesis_maps_controls_and_writes_canonical_pcm(tmp_path):
    audio = 0.2 * np.sin(np.arange(2400) / 10)
    engine = SimpleNamespace(generate_custom_voice=Mock(return_value=([audio],24000)))
    torch = fake_torch()
    model = runtime_model(engine, torch)
    config = tmp_path / "checkpoint"; config.mkdir()
    (config / "config.json").write_text(json.dumps({"model_type":"qwen3_tts","tts_model_type":"custom_voice",
        "talker_config":{"spk_id":{"ryan":0},"codec_language_id":{"english":1}}}))
    (config / "model.safetensors").write_bytes(b"test")
    request = SynthesizeRequest(text="A local voice.", voice="ryan", language="english", seed=71, max_tokens=99)
    data, info = synthesize_with_qwen(request, inspect_customvoice_model(config), "ryan", model)
    assert info.sample_rate == 24000 and info.rms_dbfs > -50
    call = engine.generate_custom_voice.call_args.kwargs
    assert call["max_new_tokens"] == 99 and call["speaker"] == "ryan"
    assert call["subtalker_temperature"] == request.temperature
    torch.random.default_generator.manual_seed.assert_called_once_with(71)
    torch.random.fork_rng.assert_called_once_with(devices=[])
    assert validate_live_wav(data).num_samples == 2400


def test_clone_uses_only_enrolled_reference_and_transcript(tmp_path):
    engine = SimpleNamespace(generate_voice_clone=Mock(return_value=([np.ones(1000)*0.1],24000)))
    model = runtime_model(engine)
    model.generate_audio(text="Test.", seed=2, output_path=str(tmp_path),file_prefix="voice",
        lang_code="italian",temperature=0.7,top_k=50,top_p=1,repetition_penalty=1.5,max_tokens=50,
        ref_audio="/private/reference.wav",ref_text="Authorised reference.")
    assert engine.generate_voice_clone.call_args.kwargs["x_vector_only_mode"] is False
    assert engine.generate_voice_clone.call_args.kwargs["ref_text"] == "Authorised reference."
    assert validate_live_wav((tmp_path/"voice.wav").read_bytes()).num_samples == 1000


@pytest.mark.parametrize("audio,rate", [(np.array([np.nan]),24000),(np.zeros((2,10)),24000),(np.ones(100),16000)])
def test_malformed_backend_outputs_are_failures(tmp_path,audio,rate):
    engine = SimpleNamespace(generate_custom_voice=Mock(return_value=([audio],rate)))
    with pytest.raises(RuntimeError):
        runtime_model(engine).generate_audio(text="Test",seed=1,output_path=str(tmp_path),file_prefix="out",
            lang_code="english",temperature=0.7,top_k=50,top_p=1,repetition_penalty=1.05,max_tokens=20,voice="ryan")
    assert not (tmp_path/"out.wav").exists()


def test_warm_identity_includes_runtime_and_decoder(tmp_path):
    path=tmp_path/"model"; path.mkdir()
    (path/"config.json").write_text("{}")
    (path/"model.safetensors").write_bytes(b"weights")
    decoder=path/"speech_tokenizer"; decoder.mkdir()
    (decoder/"model.safetensors").write_bytes(b"decoder1")
    context=["cpu-fp32"]
    manager=ModelLifecycleManager(loader=lambda _:object(),identity_context=lambda:context[0])
    with manager.acquire(path) as first: pass
    context[0]="cuda-fp16"
    with manager.acquire(path) as second: pass
    (decoder/"model.safetensors").write_bytes(b"decoder-two")
    with manager.acquire(path) as third: pass
    assert len({first.identity_sha256,second.identity_sha256,third.identity_sha256}) == 3
    assert manager.snapshot().load_count == 3


def test_seeding_and_generation_are_serialized():
    active=[]
    @backends.serialized_generation
    def generate():
        active.append(threading.get_ident())
        assert len(set(active)) == 1
        active.clear()
    threads=[threading.Thread(target=generate) for _ in range(12)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=1)
    assert all(not thread.is_alive() for thread in threads)


def test_runtime_fingerprints_preserve_legacy_and_separate_execution_options():
    from test_quality_contracts import make_segment, make_profile
    from qwen_tts_worker.models.quality import RuntimeIdentity, synthesis_fingerprint
    segment, profile = make_segment(), make_profile()
    data = profile.model_dump(mode="json")
    data["model"].pop("runtime")
    material = {"fingerprint_version":"0.1.0", "spoken_text":segment.spoken_text,
                "language":segment.language,"role":segment.role.value,"speaker_profile_id":segment.speaker_profile_id,
                "preprocessing_version":segment.preprocessing_version,"context":segment.context.model_dump(mode="json"),
                "direction":segment.direction.model_dump(mode="json"),"profile":data}
    original = hashlib.sha256(json.dumps(material,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    assert synthesis_fingerprint(segment,profile) == original
    runtime = RuntimeIdentity(**runtime_model(None).plan.as_dict())
    cpu = profile.model_copy(update={"model":profile.model.model_copy(update={"runtime":runtime})})
    gpu = cpu.model_copy(update={"model":cpu.model.model_copy(update={"runtime":runtime.model_copy(update={"device":"cuda:0"})})})
    assert len({original,synthesis_fingerprint(segment,cpu),synthesis_fingerprint(segment,gpu)}) == 3


def test_durable_portable_profile_requires_and_validates_runtime(client,monkeypatch):
    from test_quality_contracts import make_segment, make_profile
    from qwen_tts_worker.models.quality import RuntimeIdentity
    monkeypatch.setenv("QTW_BACKEND","torch")
    monkeypatch.setenv("QTW_TTS_MODE","live")
    monkeypatch.setattr(backends,"resolve_runtime",lambda:runtime_model(None).plan)
    profile = make_profile()
    payload = {"segment":make_segment().model_dump(mode="json"),"profile":profile.model_dump(mode="json")}
    assert client.post("/attempt-jobs",json=payload).status_code == 409
    runtime = RuntimeIdentity(**runtime_model(None).plan.as_dict())
    profile = profile.model_copy(update={"model":profile.model.model_copy(update={"runtime":runtime})})
    payload["profile"] = profile.model_dump(mode="json")
    assert client.post("/attempt-jobs",json=payload).status_code == 202
    payload["profile"]["model"]["runtime"]["device"] = "cuda:0"
    assert client.post("/attempt-jobs",json=payload).status_code == 409


def test_runtime_settings_read_dotenv_without_overriding_environment(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path/".env").write_text("QTW_BACKEND=torch\nQTW_DEVICE=cpu\n")
    monkeypatch.delenv("QTW_BACKEND")
    assert backend_name() == "torch"
    monkeypatch.setenv("QTW_BACKEND", "mlx")
    assert backend_name() == "mlx"
