# @av/archive-media

Free archive and stock media with licences anyone can verify (avg-fe8.2).
It searches public collections, normalizes what each says about an item's
licence, and downloads the original: never a thumbnail. It knows nothing of
episodes or the studio.

```ts
import { createArchive } from "@av/archive-media";

const archive = createArchive({ userAgent: "my-app/1.0 (https://example.org; me@example.org)" });
const { candidates, errors } = await archive.search("storm", { mediaType: "image" });
const chosen = candidates.find((c) => c.allowed)!;
const got = await archive.fetch(chosen.provider, chosen.id, { dir: "assets/images", name: "storm" });
// got.item.licence, got.item.attribution, got.sha256, got.width × got.height, got.item.raw (the evidence)
```

## Providers

None of these needs a key.

| id | Collection | Media | Licence evidence |
|---|---|---|---|
| `aic` | Art Institute of Chicago | image (IIIF, up to 3000 px) | `is_public_domain` |
| `met` | The Metropolitan Museum of Art | image | `isPublicDomain` (Open Access, CC0) |
| `cleveland` | Cleveland Museum of Art | image | `share_license_status: CC0` |
| `commons` | Wikimedia Commons | image, audio, video | `extmetadata` License / LicenseUrl |
| `nasa` | NASA Image and Video Library | image, video, audio | NASA media guidelines; an item mentioning a copyright is `unknown` |
| `internet-archive` | Internet Archive | video, audio, image | `licenseurl` |
| `openverse` | Openverse (Flickr, museums, Jamendo…) | image, audio | the source's licence and landing page |

With a free key in the environment:

| id | Collection | Media | Licence evidence |
|---|---|---|---|
| `freesound` (`FREESOUND_API_KEY`) | Freesound | audio | `license` URL per sound. The file is the HQ preview (OGG, about 192 kbps): the original needs a user's OAuth. `rendition: "preview-hq-ogg"` says so. |

## Licences

- **Each item's licence becomes one of:**
  - `public-domain`, with a `basis`;
  - `CC0-1.0`;
  - `CC-BY[-NC][-SA|-ND]-<version>`;
  - `provider:<name>`;
  - `unknown`.
- **`fetch` refuses what the policy doesn't allow.** The default allows public
  domain, CC0, CC BY and CC BY-SA. NC and ND are refused unless allowed, and
  `unknown` always is.
- **Verifying it.** Each item keeps its landing page, its licence URL and the
  provider's own response (`raw`), so the licence can be checked by anyone.

## Not an original

Openverse hands Freesound's sounds only as a preview MP3: such an item has no
file to fetch. The Art Institute of Chicago's IIIF answers only requests that
carry `AIC-User-Agent`, so its items have no preview URL a viewer could open.

## Quality

The default minimums are 1600 px on an image's long side and 720p for a
video.
- **Pictures:** the size is read again from the bytes that arrived.
- **Videos and sounds:** they are recognized by their first bytes, so a login
  page is never saved as one. Their height and length come from the
  caller's `probe` (the studio uses ffprobe). Openverse
serves Flickr images at about 1024 px, below that bar.

## Being a good client

- **Identity:** a User-Agent with a contact, which Wikimedia requires. The Art
  Institute of Chicago's IIIF images also need `AIC-User-Agent`.
- **Pacing:** requests to one host are spaced 250 ms apart.
- **Retries:** 429, 502, 503 and 504 are retried, honouring `Retry-After` up
  to 30 s.
- **Timeouts:** headers must arrive within 30 s. A download may last as long
  as bytes keep coming, and stops after 30 s of silence.
- **Cache:** JSON answers can be cached on disk for a day (`cacheDir`).

## Tests

`npm test` runs offline, on responses recorded from each provider. To check
the providers for real:

```bash
AVG_LIVE_ARCHIVE=1 npx vitest run test/live.test.ts
```
