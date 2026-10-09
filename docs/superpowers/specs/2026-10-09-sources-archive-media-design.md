# Archive media, take verification and channel sources

Beads: `avg-fe8.2` (image and video providers), part of `avg-fe8.3` (audio)
and `avg-fe8.4` (attributions); `avg-8hs.3` (take verification); `avg-dcf.2`
(the poem source). After them, `avg-dcf.8`: a new poem from scratch.

## What the person asked

- **Archive and stock media, done well, now.** They serve in many situations.
  They must be free, carry a licence anyone can verify, and be of good quality.
- **Take verification** (ASR against the text, measured pauses), as a tool of
  the application.
- **A poem's source** lives in `library/<channel>/sources/<poem>/`. Whoever
  arrives first creates it, following a procedure. Its structure may differ
  from project to project. What makes it usable is an `.md` file telling the
  agent how to read it and use it. The same holds for what lives in a channel
  or a series folder. A source is not a series.

## Order

1. **Part C: archive media.** Independent, wanted now, useful everywhere.
2. **Part B: take verification.**
3. **Part A: channel sources as workspaces.** It uses B and C.
4. **`avg-dcf.8`.** A new poem: its source first, then a short and a long that
   pin it.

Each part gets its own plan and PR.

---

## Part C: archive media (`@av/archive-media`)

### Shape

- **A new package, `packages/archive-media`.** It knows nothing of episodes or
  the studio (ADR-0032). It searches providers, normalizes what they say about
  an item, and downloads the original. Its tests run offline, on recorded
  provider responses.
- **Studio side, two Pi tools.**
  - `pva_search_media` lists candidates. Each has its licence, author, size,
    a preview URL and a landing page.
  - `pva_fetch_media` downloads one candidate into the workspace and writes
    its provenance beside it.
- **`ATTRIBUTIONS.md`.** A workspace's credits are generated from those
  provenance records, never typed by hand.
- **A shared skill, `find-archive-media`.** It says how to search, choose and
  credit.

### Providers

Each provider is an adapter with `search(query, filters)` and `item(id)`. The
adapters with no key are enabled by default. Those with a free key are enabled
when the key is in the environment.

| Provider | Key | Media | Licence evidence |
|---|---|---|---|
| Wikimedia Commons | none | image, audio, video | `extmetadata`: LicenseShortName, LicenseUrl, Artist, Credit |
| Art Institute of Chicago | none | image (IIIF, full size) | `is_public_domain`; CC0 data |
| Cleveland Museum of Art | none | image | `share_license_status: CC0` |
| The Met | none | image | `isPublicDomain` per object (search API **v1.1**: v1 was retired on 2026-10-01) |
| NASA Image and Video Library | none | image, video, audio | NASA media guidelines: generally not copyrighted, per item |
| Openverse | none (anonymous, rate-limited) | image, audio | `license`, `license_version`, `license_url` per item |
| Internet Archive | none | video, audio, image | `licenseurl` per item; items without it are refused |
| Smithsonian Open Access | free (api.data.gov) | image, 3D | CC0 flag per media |
| Europeana | free | image, video, audio | `rights` URL per item |
| Rijksmuseum | free | image | public domain or CC0 per object |
| Freesound | free | audio | CC0, CC-BY or CC-BY-NC per sound |
| Pexels, Pixabay, Unsplash | free | image, video | the provider's own licence: kept apart, never shown as CC |

### Licences

- **One vocabulary.** Every item is normalized to one of:
  - `public-domain`, with `basis` saying why: `PDM-1.0`, `PD-old-70`,
    `PD-US-expired`, `PD-USGov`, `NASA`, or the institution's flag;
  - `CC0-1.0`, `CC-BY-<v>`, `CC-BY-SA-<v>`, `CC-BY-NC-<v>`,
    `CC-BY-NC-SA-<v>`, `CC-BY-ND-<v>`, `CC-BY-NC-ND-<v>`;
  - `provider:<name>` for the Pexels, Pixabay and Unsplash licences;
  - `unknown`.
- **Each item also carries** its licence URL, whether attribution is
  required, the attribution text, the author, the title, the date, the
  institution and its landing page.
- **A policy, given by the caller, decides what may be fetched.**
  - The default allows public domain, CC0, CC-BY and CC-BY-SA.
  - NC, ND and provider licences are refused unless allowed explicitly.
  - `unknown` is always refused. A channel can set its policy in its
    `settings.yaml`.
- **Verifiable.** A fetch keeps:
  - the provider's raw metadata response, saved as evidence and named by
    hash;
  - the URL it came from, and when;
  - the file's sha256.

  Anyone can open the landing page and check.

### Quality

- **The original, never a thumbnail.** That means Commons' original file,
  IIIF `full/max` and the Met's `primaryImage`.
- **Thresholds.** A default minimum size (long side ≥ 1600 px for images,
  ≥ 720p for video) and a declared mime type, both checked again after the
  download with a media probe. Search can filter on size where the provider
  says it.
- **Duplicates** are found by hash within a workspace.

### Being a good client

- **Requests.** A User-Agent with a contact (Wikimedia requires one),
  per-provider rate limits, retries with backoff on 429 and 5xx, timeouts.
- **Caching.** Search responses are cached for a day under `.cache/`.
- **Live smoke tests.** Opt-in (`AVG_LIVE_ARCHIVE=1`), one per provider.
  Provider APIs change, as the Met's did. Offline tests use recorded
  responses.

### In a workspace

`pva_fetch_media` writes:
- `assets/images/<id>.<ext>`, or `assets/video/` or `assets/sounds/`;
- `<id>.source.json`, the provenance record (contract `MediaProvenance`,
  `studio.video/v1alpha1`), sitting beside the file the way `.sound.json`
  sits beside a sound;
- `artifacts/provenance/<hash>.json`, the raw provider metadata.

`ATTRIBUTIONS.md` is generated from every `*.source.json` in the workspace.
`vpr` also checks that every archive file still has its record and hash.

---

## Part B: take verification (`avg-8hs.3`)

- **A local transcription.**
  - The voice worker gains `POST /transcribe`: an MLX ASR model, downloaded
    on first use like the aligner, at $0.
  - The plan picks between Qwen3-ASR and Whisper on MLX by probing Italian
    accuracy on the existing takes.
  - ElevenLabs' speech-to-text is an optional second provider.
- **`pva_verify_take {workspace, take}`** writes
  `artifacts/takes/<take>.verification.json` with:
  - **words:** the transcript against the take's text, after normalization,
    with missing, extra and substituted words at their positions;
  - **pauses:** every pause between words, from the take's word timing,
    labelled `word`, `verse` (a line break in the text) or `stanza` (a blank
    line);
  - **edges:** the leading silence, and the tail after the last word, with
    its level, so a cut-off ending shows.
- **The thresholds are not the application's.** The report is data. The
  series' validator, or the source's procedure, judges it. Dentro i versi's
  UP-60 (about 0.8 s between verses, about 1.3 s at a stanza end) lives in its
  channel.

---

## Part A: channel sources as workspaces (`avg-dcf.2`)

### A folder with free structure and an instruction file

- **`library/<channel>/sources/<name>/`** may hold anything.
- **`README.md` at its root is required.** It is for people and for the agent:
  what the source holds, how it was made, how to use it, and its state
  (frontmatter `status: draft | ready`).
- **Every library level may carry one.** The same rule holds for the channel
  and series folders, which already have `README.md`. `pva_gather_context`
  shows the agent the README of the channel, of the series, and of every
  source the episode pins.

### Making a source

- **The procedure is a channel skill**, `library/<channel>/skills/<name>.md`.
  The agent discovers channel skills, today it discovers only series ones,
  and offers them for that channel's work.
- **Dentro i versi gets `skills/poem-source.md`:**
  - the text from a cited edition;
  - paintings from the archives (part C), or generated when none fits;
  - the takes `titolo` and `recita`, synthesized, registered, aligned and
    verified (part B), judged against UP-58/59/60;
  - then the README, written from the skill's template, with `status: ready`.
- **Whoever arrives first.** The series' episode skills say: if
  `sources/<poem>` is missing or not `ready`, make it with `poem-source`
  first.
- **No journal, sheet or render.** A source has none, as in CreativeStudio's
  UP-57. Its state is its files and its README. It never changes under an
  episode: the episode pins it (ADR-0035), and a correction is a new source or
  a renewed pin.

### The tools work on a source

- **Every workspace tool also accepts `source: "<name>"`** in place of
  `series` and `episode`: exactly one of the two forms, with paths relative
  to the source. That covers:
  - image, sound and speech generation;
  - registering, aligning and verifying a take;
  - probing media;
  - searching and fetching archive media.
- **One resolver**, `workspaceOf(params)`, replaces each tool's own path
  joining.

### What a compiler reads from a source

- **A pin on a channel source is compile material**, as a pin on an episode is
  today. The loader offers the parts that follow the studio's contracts:
  - `artifacts/narration/takes.json` with its audio and timings, as
    `source-<pin>-narration-<take>`;
  - `assets/images|sounds|video/*`, as `source-<pin>-image-<name>` and the
    rest.
- **Everything else in the source** is free, and is read by the agent through
  the README.
- **The renderer finds the files.** `sharedRootsOf` includes pinned channel
  sources, so the renderer finds their files. The pin's inventory is checked
  exactly as for an episode.
- **This lifts ADR-0035's restriction** "only episodes are compile
  material", with an amendment.

---

## Not in scope

- Importing CreativeStudio's media (`avg-dcf.5`): they are on another machine.
- Media storage for channel repositories (`avg-kr4`).
- Image cutout (`avg-fe8.5`) and audio editing (`avg-8hs.5`): `avg-dcf.8`
  depends on them only for parity with CreativeStudio. The test channel tests
  capabilities, so dcf.8 goes ahead without them and notes what they would
  add.

## Decisions to confirm

1. `README.md` is the instruction file at every level, rather than a new name
   such as `AGENTS.md`. The channel and series folders already have one.
2. The default licence policy: public domain, CC0, CC-BY and CC-BY-SA, with NC
   and ND refused.
3. The source procedure is a channel skill without stages in a journal. The
   "pipeline" is the skill's ordered steps and the checks its tools write.
