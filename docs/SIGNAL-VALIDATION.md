# Segment signal validation

`qwen_tts_worker.signal_validation` runs a cheap, deterministic gate over each immutable raw synthesis attempt before acceptance, retry, transformation, or mastering.

## Default policy

Policy `qwen-pcm24k-v1` requires:

- readable, hash/size-matching, non-empty uncompressed PCM WAV;
- mono, signed 16-bit, 24 kHz format;
- duration from 0.10 through 60 seconds;
- RMS above -50 dBFS and at least 0.5% active samples above -45 dBFS;
- clipped-sample ratio at or below 0.1% (`abs(sample) >= 32760`);
- normalized DC offset no greater than 0.10 (review above 0.03);
- leading/trailing silence no greater than 5 seconds (review above 1.5 seconds);
- when word count is known, 35–340 words/minute (review outside 70–240).

Every threshold is frozen in `SignalValidationPolicy`; the complete policy receives a SHA-256 fingerprint and is included in immutable evidence. These broad first-stage thresholds reject obvious signal failures. They do not establish naturalness, pronunciation, or publication quality.

## Decisions

Each check is `pass`, `warn`, or `fail` with machine-readable ID, observed value, and expected threshold:

- any failure → `reject`;
- no failures and at least one warning → `review`;
- all checks pass → `accept`.

Corrupt or absent data produces a rejection report with sentinel metrics instead of raising away the evidence. Silent fake-provider output is always rejected by speech presence and cannot be published.

## Retry and overrides

Signal/duration/rate failures may create a bounded quality retry through `AttemptStore.retry_rejected()`. A retry creates a new attempt, advances the seed deterministically, records its parent and failed check IDs, and never changes the rejected attempt. Integrity, decode, and format failures are non-retryable because repeating model sampling cannot repair storage/configuration faults.

A reviewer may override a decision only with a non-empty actor and reason. The original failed/warn checks remain in the report. Overrides are therefore visible exceptions, not threshold bypasses.

## API and storage

- `POST /attempt-jobs/{job_id}/validate` measures a terminal successful attempt and persists evidence.
- `GET /attempt-jobs/quality-reports/{report_id}` retrieves immutable evidence.
- `POST /attempt-jobs/{job_id}/retry-quality` creates an eligible bounded retry.

Reports live under `attempt-store/quality-reports/` and are write-once JSON. Raw WAVs are never modified by validation.
