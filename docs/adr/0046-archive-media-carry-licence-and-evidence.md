# ADR-0046: Archive media carry their licence and its evidence

## Status

Accepted (`avg-fe8.2`). Implemented:
- the package `@av/archive-media`;
- the contract `MediaProvenance`;
- Pi's tools `pva_search_media`, `pva_fetch_media` and `pva_check_provenance`.

## Context

Many productions need real material more than generated material: a poem's
painting, a period photograph, NASA footage, a recorded storm. It must be
free, of good quality, and its licence must be verifiable by anyone, later,
without trusting the studio's word. Stock sites and public collections state
licences in different ways: a flag, a URL, an HTML snippet, a short name.
Their APIs also change. The Met retired its v1 search on 2026-10-01.

## Decision

- **`@av/archive-media`** searches public collections, normalizes each item's
  licence into one vocabulary and downloads the original. It knows nothing of
  the studio.
  - **The vocabulary:** `public-domain` with a `basis`, `CC0-1.0`,
    `CC-BY[-NC][-SA|-ND]-<v>`, `provider:<name>`, and `unknown`.
  - **Seven providers need no key:** the Art Institute of Chicago, the Met,
    Cleveland, Wikimedia Commons, NASA, the Internet Archive and Openverse.
  - **Providers with a key** are enabled by the key's presence. They are a
    separate issue.
- **A policy decides what may be fetched.** It is set in the channel's
  `settings.yaml` (`archiveMedia`), and a series' file overrides it.
  - The default allows public domain, CC0, CC BY and CC BY-SA. NC, ND and a
    provider's own licence need the person's decision.
  - **`unknown` is never fetched.** NASA items that mention a copyright count
    as `unknown`.
- **Quality is checked on the bytes.**
  - The original, never a thumbnail.
  - At least 1600 px on an image's long side and 720p for a video, by
    default.
  - An image's size is read from the file that arrived. A file that is not
    what it claims to be (an HTML challenge page, for instance) is refused.
- **What each file carries.** It lands in `assets/images|video|sounds/` with
  `<name>.source.json` (`MediaProvenance`), naming:
  - the provider, the item and its landing page;
  - the licence, its URL and the provider's statement;
  - the credit line and the file's hash.

  The provider's own response is kept in `artifacts/provenance/<sha256>.json`
  as evidence. `ATTRIBUTIONS.md` is generated from the records, never typed.
  `pva_check_provenance` says when a file, its evidence or the credits no
  longer match.

## Consequences

- **Credits can be audited.** Anyone can open the landing page and compare it
  with the kept response.
- **Provider changes are caught.** Offline tests run on recorded responses.
  `AVG_LIVE_ARCHIVE=1` runs one real search and fetch per provider, to catch an
  API that changed.
- **Some sources are too small.** Openverse serves Flickr images at about
  1024 px, below the default bar.
- **Pi still judges fit.** The tools check licence and size, not whether the
  picture suits the shot.
