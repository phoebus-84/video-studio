# Release process

Releases are source/wheel distributions plus a private local model installer. Model weights, voices, references, generated WAVs, listener audio, and unblinding keys are never bundled.

## Preconditions

1. All required Beads are closed; deferred human listening remains clearly labeled and does not become a quality claim.
2. `main` is clean and reviewed. The release operator has explicit permission to push.
3. `__version__` and `[project].version` match the intended semantic version.
4. The supported model catalogue still identifies real immutable revisions and verified critical hashes.
5. Run on a clean Apple-Silicon checkout:

```bash
python3.12 -m venv .venv
.venv/bin/pip install --require-hashes -r requirements.txt
.venv/bin/pip install --no-deps -e .
.venv/bin/pip install pytest pytest-asyncio httpx pytest-cov mkdocs==1.6.1 build twine
.venv/bin/pytest -q
.venv/bin/python -m compileall -q src/qwen_tts_worker
.venv/bin/mkdocs build --strict
.venv/bin/python -m build
.venv/bin/python -m twine check dist/*
.venv/bin/pip check
git diff --check
git status --short
```

The weight-free test suite must pass; the opt-in live smoke remains a separately recorded local acceptance because CI does not download multi-gigabyte checkpoints.

## Tag

Prefer a signed annotated tag whose value exactly matches the package version:

```bash
git tag -s v1.0.0 -m 'qwen-tts-worker 1.0.0'
git push origin v1.0.0
```

The tag workflow refuses a mismatch, installs the macOS MLX extra, reruns tests and strict docs, checks wheel/sdist metadata, writes SHA-256 sums, emits GitHub artifact provenance attestations, and creates the immutable GitHub Release. It does not publish to PyPI automatically.

## Verification

Download the release assets and verify:

```bash
shasum -a 256 -c SHA256SUMS
gh attestation verify qwen_tts_worker-1.0.0-py3-none-any.whl --repo OWNER/REPOSITORY
python3.12 -m venv /tmp/qtw-release
/tmp/qtw-release/bin/pip install --require-hashes -r requirements.txt
/tmp/qtw-release/bin/pip install --no-deps qwen_tts_worker-1.0.0-py3-none-any.whl
/tmp/qtw-release/bin/qwen-tts --help
```

Then install a pinned CustomVoice or Base profile with `qwen-tts install`; model provenance is verified independently by `.download.json`.

## Incident response

If an artifact, dependency, model revision, or privacy boundary is compromised:

1. Mark the GitHub Release as withdrawn and document the exact affected hashes.
2. Open a P0 Bead and preserve relevant immutable evidence without committing private audio.
3. Rotate any affected repository credentials; the runtime itself stores none.
4. Issue a patched release. Do not overwrite an existing tag, wheel, model directory, or evidence artifact.
