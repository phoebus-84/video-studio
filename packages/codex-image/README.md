# @av/codex-image

Image generation and editing against OpenAI, over either a **ChatGPT
subscription** (through the Codex backend) or the **documented Images API**.

Knows nothing about Pi, episodes, channels or pipelines. The credential is
injected, files are the caller's business, and what comes back is bytes plus
provenance.

## Why two transports

They are different products to the person paying:

| Transport | Billed to | Credential | Protocol |
| --- | --- | --- | --- |
| `subscription` | a ChatGPT Plus/Pro plan | OAuth token from an `openai-codex` login | undocumented |
| `api` | API credits, per image | `OPENAI_API_KEY` | [documented](https://platform.openai.com/docs/api-reference/images) |

The caller picks. This package **never falls back** from one to the other:
quietly moving a batch of images onto metered credits is not a decision to make
on someone else's behalf.

## Usage

```ts
import { CodexImageClient } from "@av/codex-image";

// Subscription — the token comes from wherever you already logged in.
const client = new CodexImageClient({
  transport: { kind: "subscription", token: oauthToken },
});

const image = await client.generate({
  prompt: "A red fox in tall grass at golden hour, shallow depth of field",
  outputFormat: "png",
});

await writeFile("fox.png", image.data);
console.log(image.provider, image.model, image.revisedPrompt);
```

Editing — supply references, and a generation becomes an edit:

```ts
const edited = await client.generate({
  prompt: "make it night, keep the composition",
  inputImages: [{ data: await readFile("fox.png"), mimeType: "image/png" }],
});
```

Metered instead:

```ts
const client = new CodexImageClient({
  transport: { kind: "api", apiKey: process.env.OPENAI_API_KEY! },
});
await client.generate({ prompt: "…", size: "1536x1024", quality: "high" });
```

`size` and `quality` are only honoured by the `api` transport; the subscription
backend does not expose them.

## Errors

Every failure is a `CodexImageError` with a `code`:

| Code | Means | Retried |
| --- | --- | --- |
| `NO_CREDENTIAL` | missing, expired or rejected credential | no |
| `BAD_CREDENTIAL` | the token is not a JWT, or carries no ChatGPT account | no |
| `MODERATION` | the prompt was refused | no |
| `RATE_LIMIT` | quota or rate limit | yes, with backoff |
| `NETWORK` | could not reach the backend | yes, with backoff |
| `HTTP` | non-2xx | only on 5xx |
| `NO_IMAGE` | a well-formed response carrying no image | no |
| `PROTOCOL` | the response did not have the promised shape | no |
| `ABORTED` | cancelled, or the deadline elapsed | no |

Retrying a refusal spends quota and returns the same refusal, so it isn't
retried. When the model answers in prose instead of drawing, its own words come
back as the error `detail` — that text is the only explanation there is.

## The undocumented part

The subscription transport posts to
`https://chatgpt.com/backend-api/codex/responses`, the endpoint the Codex CLI
uses. It is not a public API. It can change without notice, and when it does
the failure will look like `PROTOCOL` rather than an outage.

Everything shape-dependent is therefore isolated in `src/protocol.ts`, and
`test/protocol.test.ts` is the written-down specification of what we believed
the protocol was. If it breaks, those two files are what to read.

The request is an ordinary Responses call whose only tool is the built-in
`image_generation`; the backend picks the image model (currently `gpt-image-2`)
and streams the result back as SSE, base64-encoded on an
`image_generation_call` output item.
