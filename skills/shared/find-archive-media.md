---
name: find-archive-media
version: "0.1.0"
description: Find free archive and stock pictures, videos and sounds of good quality with a licence anyone can verify (museums, Wikimedia Commons, NASA, Internet Archive, Openverse), fetch the original with its credit and evidence, and keep ATTRIBUTIONS.md right
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
---

# Find Archive Media

Real paintings, photographs, films and recordings, free and with a licence
anyone can check. Use them before generating a picture when the subject
exists in the world: a painting for a poem, a period photograph, NASA's
lightning, a recorded thunderstorm.

## Where to look

| Need | Search first |
|---|---|
| A painting, a print, a drawing, an object | `aic`, `met`, `cleveland` (museum quality, public domain or CC0), then `commons` |
| A historical photograph, a place, a person of the past | `commons`, then `met` |
| Space, the sky, rockets, weather from above | `nasa` |
| Film footage, old newsreels, recordings | `internet-archive` (video, audio), `commons` (video, audio) |
| A sound, an ambience | `commons` (audio), `openverse` (audio), `internet-archive` |
| A recent photograph of anything | `openverse`, `commons`; Flickr images through Openverse are only about 1024 px |

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
2. **Choose by eye and by fit.** Open the `preview`, and read the title,
   creator and date. Reject:
   - a detail when you need the whole work;
   - a reproduction with a frame or a museum label, unless wanted;
   - a watermark;
   - a subject that only matches the words.

   Prefer the larger original among equal choices.
3. **Fetch** with `pva_fetch_media { channel, series, episode, provider, id, name }`,
   copying `provider` and `id` exactly from the search. `name` is the asset id
   the spec uses.
   - **What you get:**
     - the original file in `assets/images|video|sounds/`;
     - `<name>.source.json` beside it;
     - the provider's response, kept as evidence;
     - `ATTRIBUTIONS.md`, made again.
   - **What it refuses:** an unknown or disallowed licence, a file smaller
     than asked, and a name already used, unless `replace: true`.
4. **Credit.**
   - `ATTRIBUTIONS.md` is the list of credits for the video description and
     the delivery. Never write it by hand.
   - CC BY and CC BY-SA require the credit. BY-SA also means a work made
     from the file is shared under the same licence: say so to the person
     when it matters.
5. **Check** with `pva_check_provenance` before a render or a delivery. Every
   file must still be the one fetched, with its evidence.

## Never

- Never use a file whose licence is `unknown`, or download one by other means
  (a browser, curl) to get around the policy. A file without a verifiable
  licence has no place in a video.
- Never change the channel's licence policy on your own. NC and ND need the
  person's decision, written in the channel's `settings.yaml` (`archiveMedia.licences`).
- Never crop out, cover or alter a credit a licence requires.
- Never present a reproduction as something else: a painting is credited to
  its painter and its museum.
