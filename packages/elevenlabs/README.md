# @av/elevenlabs

A small client for the ElevenLabs API, with the studio's rate and retry
rules. Today it does forced alignment (avg-8hs.2); speech synthesis joins it
with avg-8hs.1.

```ts
import { forcedAlignment, ELEVENLABS_PROFILES, ElevenLabsError } from "@av/elevenlabs";

const { words, loss } = await forcedAlignment({
  audioPath: "/abs/take.wav",
  text: "La nebbia a gl'irti colli",
  apiKey: process.env.ELEVENLABS_API_KEY!,   // the caller reads the key; this package reads no environment
});
// words: [{ text, start, end, loss? }]
```

## Rules

- One request at a time per process.
- At most two retries, only for 429 and 5xx — answers that say the request
  was not processed — waiting `Retry-After` (or 2 s, then 4 s, at most 30 s).
- Never a retry for a refused key (`auth`) or a spent quota (`quota`).
- A connection lost after the request left is `uncertain` and not retried:
  it may have been processed, and billed. No connection at all is
  `unreachable`: nothing was sent.
- The key never appears in an error.

`ElevenLabsError.code`: `auth`, `quota`, `rate-limited`, `bad-request`,
`server`, `unreachable`, `uncertain`.

## Price

ElevenLabs returns no price for alignment; `ELEVENLABS_PROFILES.forcedAlignment.usdPerMinute`
is an estimate the studio's spend ledger reserves and settles at. Edit it
when the plan's price changes.

## Tests

```bash
npm test --workspace @av/elevenlabs   # against a local fake of the API; no key, no network
```
