# Blinded listening review publication

Human evaluation is intentionally deferred. The current protocol requires exactly three independent listeners, each completing all 54 randomized isolated A/B items and one independently randomized, loudness-matched full assembly item. Older 54-row exports are incomplete.

The public review package contains only opaque A/B filenames, the 55-item browser form, audio, and content hashes. It excludes unblinding keys, objective comparison files, model names, and prior scores. The page exports a 55-row pseudonymous CSV locally in the listener's browser; it has no analytics or submission backend.

## Prepare without committing audio

Raw review runs and audio remain ignored by Git. On the trusted production Mac:

```bash
PYTHONPATH=src .venv/bin/python evaluation/create_listening_review.py \
  --run evaluation/runs/candidate-qtw-v1

PYTHONPATH=src .venv/bin/python evaluation/package_listening_review.py create \
  --source evaluation/runs/candidate-qtw-v1/results \
  --output /tmp/candidate-qtw-v1-listening-review.tar.gz

shasum -a 256 /tmp/candidate-qtw-v1-listening-review.tar.gz
```

The packager fails unless the page has the current 55 ordered items, 110 expected audio references, working escaped-newline CSV export, and every referenced WAV. It deterministically packages only allowlisted files.

## Stage for a later Pages deployment

After a repository remote exists and the operator explicitly approves making blinded audio public:

```bash
gh release create listening-candidate-qtw-v1 \
  --prerelease --title 'Blinded listening package candidate-qtw-v1' \
  /tmp/candidate-qtw-v1-listening-review.tar.gz
```

Run the **Qwen TTS documentation** workflow from GitHub Actions with:

- `review_release_tag`: `listening-candidate-qtw-v1` to publish the form and audio;
- blank tag to publish documentation only.

The workflow downloads the exact release asset using the repository token, runs the same strict verifier into `listening/candidate-qtw-v1/`, and uploads a GitHub Pages artifact. A malformed archive, extra file, traversal path, forbidden key-like filename, hash mismatch, wrong item count, or broken export blocks deployment.

## Collect and analyze

Listeners return only pseudonymous CSV files. Store the three complete exports under `evaluation/listening/candidate-qtw-v1/`, then run:

```bash
PYTHONPATH=src .venv/bin/python evaluation/analyze_listening_scores.py \
  evaluation/listening/candidate-qtw-v1/listener-1.csv \
  evaluation/listening/candidate-qtw-v1/listener-2.csv \
  evaluation/listening/candidate-qtw-v1/listener-3.csv
```

Do not publish or infer the A/B key before collection closes. Objective evidence and successful production renders do not substitute for this panel.
