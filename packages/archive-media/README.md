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

## Native stock expansion

The CreativeStudio stock integration is ported to native TypeScript providers;
there is no subprocess bridge or dependency on a CreativeStudio checkout.
The registry now has **22 providers** (Poly Haven remains in the separate Blender integration).

| id | Media | Key environment variable |
|---|---|---|
| `pexels` | image, video | `PEXELS_API_KEY` |
| `pixabay` | image, video | `PIXABAY_API_KEY` |
| `unsplash` | image | `UNSPLASH_ACCESS_KEY` |
| `coverr` | video | `COVERR_KEY` |
| `smithsonian` | image, CC0 media | `SMITHSONIAN_KEY` |
| `rijksmuseum` | image | none |
| `wellcome` | image | none |
| `inaturalist` | image, rights per photo | none |
| `jamendo` | audio/music, explicit download permission required | `JAMENDO_CLIENT_ID` |
| `ccmixter` | audio/music | none |
| `iconify` | SVG icons, rasterized to PNG | none |
| `emoji` | Fluent/Noto/OpenMoji emoji, animated WebP where available | none |
| `lottie` | LottieFiles animations (MP4 rendition) | none |
| `mapillary` | street-level imagery, CC BY-SA | `MAPILLARY_TOKEN` |

The agent reads these keys from the environment or the project's `.env`.
`FREESOUND_API_TOKEN` is accepted by the agent as a legacy alias for
`FREESOUND_API_KEY`. Never copy keys into settings or provenance records.

**Platform stock is opt-in:** Pexels, Pixabay, Unsplash and Coverr are not CC0.
The default policy is unchanged. An operator may explicitly authorize, for
example, `provider:pexels` in the channel's `archiveMedia.licences`.
Passing `onlyAllowed: false` to the agent search explains refusals; it does
not override them. Missing keys or unknown providers explicitly selected
by name produce errors instead of misleading empty results.

`search` additionally accepts `orientation` (portrait/landscape/square),
`minWidth`, `maxDurationSeconds`, and `diverse` (interleaved providers).
Explicit size/duration filters exclude records whose metadata cannot prove
the filter. The download still measures the actual bytes. IDs returned by
search must be copied verbatim: Pexels/Pixabay use `image/<id>` or `video/<id>`;
iNaturalist uses `<observation>.<photo>`.

New providers have CDN allowlists, enforced at every download redirect.
Unsplash and Coverr download accounting runs only after policy and metadata
quality checks. A failed accounting call aborts the download. API query keys
are omitted from HTTP error URLs; echoed keys are redacted from JSON evidence
and caches, whose identity includes authentication headers.

Renditions are explicit: Pixabay large images and Coverr MP4s are not
represented as original-resolution files. Items that expose several provider
renditions list them (`renditions`), and `fetch({ rendition })` selects one by
its stable id; the default remains the quality-first choice. iNaturalist CC0
photos can be imported. Other iNaturalist photo licence codes lack an exact
CC version: they remain `unknown` and are refused before downloading until
versioned per-photo evidence is available; a CC version is never invented.
Jamendo streams without explicit download permission are not offered as
downloadable assets.

### Vector, emoji and animation

SVG is active XML in a browser. `fetch` never writes provider SVG: it is parsed
with `@resvg/resvg-js` (scripts and remote references are not executed) and
emitted as an inert PNG at least as large as the quality floor. A vector that
cannot be rasterized is refused, never saved raw. Icons carry their icon set's
software licence (`provider:mit`, `provider:ofl-1.1`, CC BY…); brand/logo sets
add a trademark note. LottieFiles is fetched as its reviewed MP4 rendition —
the Lottie JSON itself is executable-bearing and is never downloaded as an
asset. Mapillary reads the Graph API behind `MAPILLARY_TOKEN`, geocodes via
Nominatim when given a place, keeps only `.fbcdn.net`/`.mapillary.com` file
CDNs, and records the CC BY-SA 4.0 credit and share-alike terms.

### Mapillary beyond one item

`createMapillary` is the geospatial layer behind the `mapillary` provider: it
geocodes a place (or takes `lat,lng`), lists coverage ranked by the longest
straight run, measures a sequence's length and runs, finds the best stills and
the same spot across years, aggregates map features and detections, and
returns the best still of an image. `runs`, `bearing`, `distance`, `compass`
and `bbox` are pure and offline. The episode layer (`saveMapillaryStill`,
`renderMapillaryHyperlapse`, `renderMapillaryPan`, `renderMapillaryPlanet`)
turns those into workspace assets with chained provenance and the CC BY-SA
credit; 360° reprojection and frame assembly use ffmpeg's `v360`.

### Reuse and derivatives

`findLocalMedia` scans a channel's canonical provenance records so an episode
can reuse an asset already licensed in the channel; `reuseLocalMedia` copies
the bytes, the record and the evidence, and returns the existing file when the
same SHA-256 and licence/evidence are already verified in the destination.
Reuse and Mapillary production apply the destination series'
policy and quality, not the permission a different series once granted.
`deriveMedia` makes an immutable local
derivative (trim by start/duration, optional 1080×1920 centre crop) with
chained provenance: the original file and its record are never altered.
Poly Haven already has its own tool.

The studio APIs for reuse and derivation are asynchronous. Derivatives embed
verified parent provenance snapshots, their hashes and original evidence bytes
in `studio-media-derivation` evidence (version 1). `checkProvenance` validates
the whole embedded chain, even after reuse into a different episode. Legacy
local derivation evidence without this chain is refused: regenerate the asset
from verified sources. ND permission to download does not authorize cropping
or trimming. Rendering is cancellable, staged on the destination filesystem,
and published without overwriting existing files; failure/cancellation removes
partial media so the same name can be retried. Real paths are checked to keep
source and destination symlinks within their workspace.

Mapillary productions accept the channel/series policy and quality, measure
their actual outputs and record source-image hashes, provider metadata and
camera/interpolation settings. Video productions are limited to 120 seconds
and 1–60 fps. The geospatial HTTP client and FFmpeg work respect cancellation.
The series loader offers `assets/video/<name>.*` as `video-<name>` and pinned
clips as `source-<pin>-video-<name>`; a series compiler must explicitly use
that asset (for example with `clip@1.0.0`). No clip is inserted automatically.

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
