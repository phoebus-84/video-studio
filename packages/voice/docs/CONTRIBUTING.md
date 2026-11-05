# Contributing to qwen-tts-worker

## Project layout

```
qwen-tts-worker/
├── pyproject.toml          # Package metadata and build config
├── requirements.txt        # Locked dependency versions
├── src/qwen_tts_worker/    # Application source
│   ├── __init__.py
│   ├── __main__.py         # Entry point
│   ├── app.py              # FastAPI application factory
│   ├── config.py           # Typed settings
│   ├── logging_config.py   # Structured logging setup
│   ├── cli/                # CLI commands
│   │   └── __init__.py     # Model download command
│   ├── models/             # Pydantic API models
│   │   ├── health.py
│   │   ├── errors.py
│   │   ├── registry.py     # Model catalogue and validation
│   │   ├── diagnostics.py  # External dependency probes
│   │   ├── voices.py
│   │   └── jobs.py
│   └── routes/             # API route handlers
│       ├── health.py
│       ├── models.py       # Model registry endpoints
│       └── voices.py
├── tests/                  # Test suite
│   ├── conftest.py
│   ├── test_app.py
│   ├── test_config.py
│   ├── test_diagnostics.py
│   ├── test_download.py
│   ├── test_errors.py
│   ├── test_health.py
│   ├── test_logging.py
│   ├── test_models.py
│   ├── test_models_endpoints.py
│   └── test_registry.py
└── docs/                   # Documentation
    ├── API.md
    ├── OPERATOR.md
    └── CONTRIBUTING.md
```

## Development setup

```bash
# Create a virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install in editable mode with dev dependencies
pip install -e ".[mlx,dev,docs]"
```

## Running the service

```bash
QTW_LOG_LEVEL=debug QTW_LOG_FORMAT=console python -m qwen_tts_worker
```

The interactive API docs will be at `http://127.0.0.1:8000/docs`.

## Running tests

```bash
# All tests
pytest

# With coverage
pytest --cov=src/qwen_tts_worker --cov-report=term-missing

# A single file
pytest tests/test_health.py -v

# A single test
pytest tests/test_health.py::TestHealthEndpoint::test_health_model_starts_none -v
```

The default suite is hardware-independent and exercises the complete durable queue, cache, restart, cancellation, fake-provider labeling, validation rejection, transform, and mastering lifecycle. Fake silence is intentionally rejected by the publication signal gate.

Run the Apple-Silicon live smoke only with explicit local weights:

```bash
QTW_RUN_MLX_SMOKE=1 \
QTW_MLX_SMOKE_MODEL="$PWD/models/qwen3-tts-1.7b-customvoice-8bit" \
pytest -q tests/test_mlx_opt_in_smoke.py -s
```

The smoke downloads nothing. It produces two live canonical segments, verifies output probes, and requires exactly one model load/two synthesis records. The configured checkpoint may be the pinned 0.6B CustomVoice profile when installed; CI never requires model weights.

## Model registry conventions

`models/catalog.py` is the **single source of truth** for supported size/profile combinations, immutable upstream revisions, installed size, and critical file hashes. `models/registry.py`, the installer, diagnostics, and cloning route all consume it. When changing support:

1. Add or remove a real upstream checkpoint in `MODEL_SPECS`; never invent a Cartesian combination.
2. Verify checkpoint type, exact revision, complete snapshot requirements, and critical SHA-256 values.
3. Update the operator model matrix.
4. Add catalogue, installer, registry, and endpoint tests.

The registry never claims an unsupported combination exists. The
`GET /models` endpoint returns exactly what the registry declares.

## Code conventions

- **Python 3.10+**: Use `from __future__ import annotations` everywhere.
- **Type hints**: All public functions must have complete type annotations.
- **Pydantic v2**: Use `model_dump(mode="json")` for serialisation, not `.dict()`.
- **Imports**: Standard library → third-party → local. Sort alphabetically within groups.
- **Docstrings**: Google-style. Every public module, class, and function must have one.

## Adding a new endpoint

1. Define the request and response models in `src/qwen_tts_worker/models/`.
2. Export them from `models/__init__.py`.
3. Create a new router module in `src/qwen_tts_worker/routes/`.
4. Include the router in `routes/__init__.py`.
5. Write tests in `tests/`.
6. Update `docs/API.md` with the new endpoint documentation.

## Before submitting

- All hardware-independent tests pass: `pytest`
- `python -m compileall -q src` and `git diff --check` pass
- No model weights, private voice references, listener audio, or unblinding keys are staged
- Live MLX dependencies remain lazy in hardware-independent tests
- Documentation and the OpenAPI schema reflect API changes

## Issue tracking

Work is tracked once, for the whole repository, at its root.

