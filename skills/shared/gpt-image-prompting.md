# GPT-Image Prompt Engineering Guide

## Model Info
- **Provider**: OpenAI, reached either through a ChatGPT Plus/Pro plan
  (`openai-codex`) or the Images API
- **Backend model**: `gpt-image-2` — the plan's routing model (`gpt-5.5` and
  friends) only decides who dispatches the request; the picture is always drawn
  by `gpt-image-2`
- **Architecture**: instruction-following, not diffusion — it reads a prompt the
  way a model reads a brief, so prose beats keyword soup

## How it differs from the fal models

| | fal (flux, nano-banana) | gpt-image |
| --- | --- | --- |
| Prompt style | tag-and-keyword friendly | write sentences |
| Negatives | supported by some models | **no negative prompt** — say what you *do* want |
| Seeds | returned, reusable | **none** — you cannot re-roll the same image |
| Consistency | seed + prompt | reference images |
| Billing | per image | against the plan |

The missing seed is the important one. With fal you pin a look by reusing a
seed; here you pin it by passing the previous image back as a reference.

## Prompting Rules

### 1. Write a brief, not a tag list

```
A weathered brass compass resting on a nautical chart, late afternoon light
raking across it from the left, shallow depth of field, the needle in focus
and the chart's edges falling soft.
```

Not: `compass, chart, brass, dof, cinematic, 8k, masterpiece`. Quality tags do
nothing here and crowd out the description.

### 2. Say what you want instead of what you don't

There is no negative prompt. "No people" is unreliable; "an empty workshop at
dawn, tools laid out on the bench" is not.

### 3. Text rendering is strong — quote it and place it

```
A hand-lettered chalkboard reading "SOUP OF THE DAY", centred, with
"Tomato & Basil" beneath it in smaller script.
```

Text-heavy images are where `gpt-image-2` most clearly beats the fal models.
Keep to a handful of text elements and name their relative positions.

### 4. Consistency comes from references, not seeds

To keep a character or style across scenes, pass the earlier image as a
reference and describe only the change:

```
Same character, same jacket and hair, now standing at the harbour wall at dusk.
```

The tool sends up to five references; the first carries the most weight.

### 5. State the composition you need

The renderer will happily centre everything. If a scene needs headroom for a
lower third or a title, ask for it: "framed with the subject on the right third,
upper-left kept clear and uncluttered."

### 6. Expect the prompt to be rewritten

The backend often returns a `revised_prompt` describing what it actually drew.
It is recorded in the artifact details — read it when a result surprises you,
because it usually explains the gap.

## Failure modes

- **Refusal (`MODERATION`)** — the prompt tripped content moderation. Rephrase;
  retrying verbatim spends quota and fails the same way.
- **Prose instead of a picture (`NO_IMAGE`)** — the model answered in words. Its
  answer is carried in the error detail and usually says why.
- **Quota (`RATE_LIMIT`)** — plan image quota is exhausted. Either wait, or set
  the series back to a fal model.

## Selecting this provider

Per series or channel, in `pipeline.yaml`:

```yaml
image:
  provider: openai-codex        # or openai-codex/<routing-model>
```

Anything else is treated as a fal model id, so existing series keep working
untouched. Choose gpt-image for text-heavy frames, diagram-like compositions and
identity-sensitive edits; choose fal when you want per-image cost control and
reproducible seeds.
