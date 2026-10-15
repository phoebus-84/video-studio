---
name: find-archive-media
version: "0.3.0"
description: Find free archive, stock, icon, emoji, animation and Mapillary street-level media with a licence anyone can verify, fetch the original with its credit and evidence, reuse what the channel already licensed, derive trims and 9:16 versions, and keep ATTRIBUTIONS.md right
inputs:
  - name: need
    type: string
    description: What the shot or the scene needs (subject, period, mood, orientation), and the episode it goes in
outputs:
  - assets/:
      kind: directory
      description: The original file with <name>.source.json beside it; artifacts/provenance/ (the provider's response); ATTRIBUTIONS.md
capabilities:
  - archive-media
  - media-reuse
  - media-derivatives
---

# Find Archive Media

Real paintings, photographs, films and recordings, free and with a licence
anyone can check. Use them before generating a picture when the subject
exists in the world: a painting for a poem, a period photograph, NASA's
lightning, a recorded thunderstorm.

## Where to look

| Need | Search first |
|---|---|
| A painting, a print, a drawing, an object | `aic`, `met`, `cleveland`, `rijksmuseum`, `wellcome`, `smithsonian` (key required), then `commons` |
| A historical photograph, a place, a person of the past | `commons`, then `met` |
| Space, the sky, rockets, weather from above | `nasa` |
| Film footage, old newsreels, recordings | `internet-archive` (video, audio), `commons` (video, audio) |
| A sound, an ambience | `freesound` (when its key is set: recorded effects and ambiences, CC0 / BY), then `commons` (audio), `internet-archive`, `openverse` (audio) |
| A recent photograph of anything | `openverse`, `commons`; `pexels`, `pixabay`, `unsplash` with keys and channel approval of their platform licences |
| Modern stock video | `pexels`, `pixabay`, `coverr` with keys and platform-licence opt-in |
| Wildlife and plants | `inaturalist`: use the photo's licence and photographer, not the observation's rights |
| Music | `ccmixter`, `jamendo` (client ID required), then `openverse` with mediaType audio; NC/ND remain refused by default |
| An icon, a pictogram, a UI symbol | `iconify` (an icon set's own software licence) |
| An emoji, including an animated one | `emoji` (Fluent, Noto, OpenMoji) |
| A vector animation, a logo sting, a loader | `lottie` (LottieFiles, fetched as its reviewed MP4 rendition) |
| Street-level imagery of a real place | `mapillary` (`MAPILLARY_TOKEN`; place name or `lat,lng`; CC BY-SA) |

- Search museums in **English**: "storm painting", "lightning landscape",
  "harvest", "autumn wine".
- Search Commons in the subject's language, and in English.

## Steps

1. **Search** with `pva_search_media { channel, series, query, mediaType }`.
   - It lists only what the channel's policy allows, by default public
     domain, CC0, CC BY and CC BY-SA, at least 1600 px on an image's long
     side and 720p for a video.
   - It says how many it left out. `onlyAllowed: false` shows them with the
     reason.
   - Use `orientation`, `minWidth`, `maxDurationSeconds` when needed; records
     with unknown corresponding metadata cannot pass those filters.
     `diverse: true` interleaves providers.
   - Copy provider IDs exactly. Pexels/Pixabay IDs include `image/` or
     `video/`; iNaturalist IDs include both observation and photo.
   - Platform providers require keys and explicit policy entries such as
     `provider:pexels`. Never broaden a channel's policy without permission.
   - The agent supports keys in the environment or project `.env`:
     `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`, `COVERR_KEY`,
     `SMITHSONIAN_KEY`, `JAMENDO_CLIENT_ID`, `MAPILLARY_TOKEN`,
     `FREESOUND_API_KEY` (legacy alias `FREESOUND_API_TOKEN`). Never print
     key values.
2. **Choose by eye and by fit.** Open the `preview`, and read the title,
   creator and date.
   - The Art Institute of Chicago gives no preview. Its images answer only
     requests naming themselves, so open its landing page instead.
   - Sounds have no playable preview. Choose them by title, length and
     source, and say to the person that you could not listen to them. Reject:
   - a detail when you need the whole work;
   - a reproduction with a frame or a museum label, unless wanted;
   - a watermark;
   - a subject that only matches the words.

   Prefer the larger original among equal choices.
3. **Fetch** with `pva_fetch_media { channel, series, episode, provider, id, name }`,
   copying `provider` and `id` exactly from the search. `name` is the asset id
   the spec uses. When the search lists `renditions`, pass `rendition` to
   choose one; otherwise the quality-first choice is fetched.
   - **What you get:**
     - the original or explicitly identified rendition in `assets/images|video|sounds/`;
     - `<name>.source.json` beside it;
     - the provider's response, kept as evidence;
     - `ATTRIBUTIONS.md`, made again.
   - **What it refuses:**
     - an unknown or disallowed licence;
     - a file smaller than asked, or one that is not the medium it claims to
       be;
     - a Freesound sound through Openverse, which offers only a preview;
     - a name already used, unless `replace: true`. Even then, never a file
       that did not come from the archive.
   - **Vectors, emoji and animation:** provider SVG is rasterized to an inert
     PNG, never saved as active XML; an icon keeps its software licence and
     any trademark note; LottieFiles is fetched as its MP4 rendition, never
     the JSON.
   - **Before calling a provider**, check `pva_search_local_media`: an asset
     already licensed in the channel can be reused with
     `pva_reuse_local_media`, which leaves the provider alone and copies the
     bytes, record and evidence (the same SHA-256 is not copied twice).
   - **Trim and vertical conversion** are `pva_derive_media`: it writes a new
     recorded asset and never alters the original.
4. **Credit.**
   - `ATTRIBUTIONS.md` is the list of credits for the video description and
     the delivery. Never write it by hand.
   - CC BY and CC BY-SA require the credit. BY-SA also means a work made
     from the file is shared under the same licence: say so to the person
     when it matters.
5. **Check** with `pva_check_provenance` before a render or a delivery. Every
   file must still be the one fetched, with its evidence.

## Mapillary productions

Street-level imagery needs `MAPILLARY_TOKEN`. `pva_mapillary` queries and
produces; every output carries the CC BY-SA 4.0 credit and, for derivatives,
the share-alike obligation:

| action | what it gives |
|---|---|
| `coverage` | sequences around a place/point, ranked by their longest straight run — the ones fit for a hyperlapse |
| `sequence` | one sequence: images, length, dates, best runs (with `geojson` for maps) |
| `photo` | the best stills near a point, closest then highest quality |
| `history` | the same spot across years, one image per year |
| `features`, `detections` | objects and traffic signs on the map; classes segmented in one image |
| `still`, `hyperlapse`, `pan`, `planet` | produce into an episode: one still (optionally 9:16), a 1080×1920 MP4 along a sequence, a camera turn inside a 360° image, a tiny planet |

- Use `coverage` first, then `hyperlapse` with the winning `seq`.
- `pan` and `planet` need a 360° (`is_pano`) image.
- Say the share-alike term to the person when the derived video is published.

## Separate asset workflows

Poly Haven remains `pva_poly_haven` (three-dimensional assets and HDRIs).
Iconify, emoji, Lottie and Mapillary are native here, subject to the same
licence and provenance rules. SVG and Lottie JSON are never saved as assets:
SVG becomes PNG, Lottie becomes its MP4 rendition. Never trim or crop the
fetched original in place: derive a separately recorded asset with
`pva_derive_media` (or `pva_mapillary`) so provenance checks continue to
validate the source.

## Never

- Never use a file whose licence is `unknown`, or download one by other means
  (a browser, curl) to get around the policy. A file without a verifiable
  licence has no place in a video.
- Never change the channel's licence policy on your own. NC and ND need the
  person's decision, written in the channel's `settings.yaml` (`archiveMedia.licences`).
- Never crop out, cover or alter a credit a licence requires.
- Never present a reproduction as something else: a painting is credited to
  its painter and its museum.
