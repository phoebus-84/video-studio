# Native MLX batching evaluation

## Decision

Native Qwen3-TTS batching remains disabled in the durable production path. `mlx-audio==0.4.6` implements `batch_generate`, but its random stream is batch-scoped rather than segment-scoped. A segment's PCM changes when unrelated neighbors or order change, which conflicts with immutable per-segment fingerprints, selective retry, and exact seed replay.

## Capability

The pinned CustomVoice implementation reports batch support when a valid shared language and one voice per text are supplied. Base cloning also supports a batch only when every item shares the same reference audio and exact transcript. The API has one `temperature`, `top_k`, `top_p`, repetition penalty, language, and token ceiling for the entire batch. It exposes no per-item seed.

## Apple-Silicon measurement

A warm pinned 1.7B CustomVoice 8-bit model synthesized:

```text
A: The archive belongs to you.
B: The message remains readable.
seed: 61001
sampling: temperature 0.7, top_k 50, top_p 1.0, repetition_penalty 1.05
max_tokens: 300
```

Two singleton batch calls took 2.608 and 2.346 seconds (4.953 seconds total). One two-item batch took 3.299 seconds, a 33.4% wall-time reduction for this tiny probe. This is a performance observation, not a representative throughput claim.

A repeated `[A, B]` batch with the same seed reproduced both float-array SHA-256 values exactly. However:

| Grouping | A hash prefix | B hash prefix |
|---|---|---|
| `[A, B]` | `6a9eacd8dd3c` | `bca3f52d22d2` |
| repeated `[A, B]` | `6a9eacd8dd3c` | `bca3f52d22d2` |
| `[B, A]` | `397d748886b9` | `5837f8ba8de2` |
| singleton `[A]` | `c542694cd442` | n/a |

Thus fixed-batch replay is deterministic, while segment identity is not independent of batch membership and position. Sample counts also changed between grouped and singleton generation.

## Reconsideration gate

Batching may be reconsidered only if the backend accepts independent per-item RNG state (or an equivalent proven stream partition), and tests demonstrate:

1. identical segment PCM for singleton, reordered, and regrouped execution under the same segment seed;
2. one failed/cancelled segment does not change accepted siblings;
3. cache fingerprints include every batching control without filename/order dependence;
4. representative throughput and peak-memory benefits justify the extra scheduler complexity;
5. signal and blinded listening gates show no regression.

Until then, the warm singleton model and one durable attempt job at a time provide predictable recovery and provenance. Native batching is an optional optimization, not a correctness requirement.
