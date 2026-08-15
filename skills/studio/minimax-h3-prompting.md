---
name: minimax-h3-prompting
description: Create, rewrite, or audit MiniMax H3 video prompts with image, video, or audio references. Use for H3 Omni Reference, First/Last Frame, text-to-video, identity, performance, motion, camera, voice, dialogue, editing, VFX replacement, and continuity.
---

# Create MiniMax H3 videos

Turn a scene brief and ordered media into one copy-ready MiniMax H3 prompt. This is a self-contained skill: do not look for companion files.

## In this studio

The `video.generate` capability is bound to MiniMax H3 through the fal adapter.
Three endpoints are registered as profiles, and the adapter validates against
them before spending anything:

| Intent | Profile |
| --- | --- |
| No media references | `minimax/h3/text-to-video@v1` |
| One or two boundary images | `minimax/h3/image-to-video@v1` |
| Several reference assets | `minimax/h3/reference-to-video@v1` |

The profile enforces the parameter names, enums, duration range and reference
counts, so an over-long list or an unsupported resolution fails locally rather
than after a paid round trip. Every generation records its profile id and
schema fingerprint, so a finished video can be traced to the exact schema that
produced it.

## Authority and execution

- Use this skill only for MiniMax H3.
- Inspect the live endpoint or generation interface before execution. Its exact mode, tokens, limits, duration, aspect ratio, prompt ceiling, and media constraints override this file.
- Write, format, rewrite, or audit prompts without running a model. Submit one job only when the user explicitly asks to generate; never add an automatic proof, batch, or retry.
- Ask only when a missing fact changes reference order, identity ownership, source master, exact dialogue, or story outcome. Infer harmless production detail.

## Select the smallest mode

| Intent | Use |
| --- | --- |
| No media references | Text-to-video |
| One or two boundary images | First/Last Frame |
| Several reference assets | Omni Reference |
| Source video is the authoritative timeline | Edit / replacement |
| Source video supplies acting, motion, or camera | Performance or camera transfer |
| Audio supplies a target voice | Voice transfer |

Fallback provider snapshot when no live contract is supplied: 4–15 seconds at 24 FPS; text prompts up to 7,000 characters; text ratios `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`; Omni also supports Auto. Omni accepts up to 9 images, 3 videos, and 3 audio files (12 total); each video/audio is 2–15 seconds and each modality totals at most 15 seconds. Audio needs at least one image or video. Images are JPG/JPEG/PNG/WEBP/HEIC/HEIF (≤30 MB); video is H.264/H.265 with AAC/MP3 audio (≤50 MB); audio is WAV/MP3 (≤15 MB). Never loosen a live interface constraint to match this fallback.

## Map references exactly

Use the interface-provided ordered binding map. H3 normally uses compact tokens with no `@` and no spaces:

```text
Image1  Image2  Video1  Audio1
```

Each token is its upload-order slot. Do not infer it from a library label, filename, or UUID; do not renumber it. Give every asset one bounded job and name what it must not contribute:

```text
Image1 defines Maya's face, hair, body, and wardrobe only. Ignore its background and pose.
Image2 defines the studio layout, materials, and lighting only. Ignore its people.
Video1 defines only body motion, performance timing, and camera rhythm. Do not inherit its actors, wardrobe, or location.
Audio1 defines Maya's voice timbre, accent, cadence, and delivery only.
```

Use separate named roles for identity, wardrobe, prop, scene, style, motion, performance, camera, edit rhythm, voice, music, and sound. Never rely on “use the references” or “respectively.”

## Write in production order

Use only the sections that materially constrain the result:

```text
[REFERENCE USE]
[IDENTITY / CONTINUITY LOCKS]
[SCENE]
[DIALOGUE]
[SCREEN GEOGRAPHY]
[SHOT LIST]
[ACTING]
[LIGHT AND IMAGE]
[CAMERA]
[PRODUCTION SOUND]
[NEGATIVES]
```

Stable truth comes before action. Lock subject count, identity, wardrobe, prop ownership, voice ownership, left/right positions, eyelines, and screen direction only where continuity needs it. Give actors objectives and observable behavior—gaze, posture, breath, interrupted movement, or listening—rather than generic emotion labels.

For one continuous action, write natural chronological prose. For more than one beat, use consecutive non-overlapping time ranges inside the requested duration. Each range gets one primary visible event and a usable end state:

```text
0–4s — medium two-shot on a 40 mm lens; slow push-in; Maya opens the case and says, “We begin now.” End with the device lit in her left hand.
4–9s — over-the-shoulder close-up; hold the axis; Jon watches the light, then nods. End with both characters facing the device.
```

Treat ranges as pacing budgets, not frame-accurate edit points. Reserve time for natural dialogue and reactions.

Put exact dialogue in double quotes, bind it to one speaker, and state language/delivery when useful. Keep the audio-reference role separate from the final mix:

```text
Maya speaks in natural conversational American English, quiet but firm: “We begin now.”
Native stereo studio tone and the case latch remain under clear dialogue. No music or subtitles.
```

Keep negatives short and observable: no extra people, identity drift, wardrobe or voice swaps, broken eyelines, duplicate props, position reversals, subtitles, unmotivated cuts, or unwanted music.

## Mode clauses

### Performance or camera transfer

State precisely what the source video controls and exclude everything else:

```text
Video1 defines only the body mechanics, expression order, interaction rhythm, and camera movement. Do not inherit its people, clothing, or location.
Recreate its action order with Maya from Image1. Preserve every handoff, pause, contact, occlusion, direction change, and final position.
```

### Voice transfer

Bind one audio reference to one target and line. Require lip sync and voice ownership; keep room tone/effects separate:

```text
Audio1 defines only Maya's voice timbre, accent, cadence, and emotional delivery.
Maya says exactly: “We begin now.” Preserve accurate lip sync and native stereo room tone.
```

### First/Last Frame

Use the dedicated image fields, not an Omni array. State the exact observable boundary states and the single causal motion between them:

```text
Image1 is the exact first frame; preserve its subject count, identity, composition, lighting, and object positions.
Image2 is the exact last frame; arrive naturally at its composition, lighting, and object positions.
No hard cut, teleportation, duplicate subject, prop swap, or discontinuous light.
```

### Targeted edit or replacement

One source video is the sole master. Name the exact change and preserve all else:

```text
[SOURCE MASTER]
Video1 is the sole editing master for subjects, performance, scene, timeline, camera, occlusions, dialogue, ambience, and event order.

[REFERENCE USE]
Image1 defines only the replacement object's appearance, structure, material, and color. Ignore its background and pose.

[EDIT]
Replace only <source target> with <replacement>. Keep exactly one instance. It inherits the source's motion path, contact, occlusion, rotation, scale, speed, and visibility.

[PRESERVE]
Do not change any other subject, object, action, background, light, camera, cut, dialogue, sound effect, ambience, or duration.
```

For environment/VFX replacement, preserve foreground identity, hair/fabric edges, performance, camera, timing, and occlusions; require coherent parallax, relighting, shadow, reflection, and interaction.

## Validate and return

Before returning or submitting, confirm:

- The endpoint/mode and all tokens match the live interface and attachment order.
- Every reference has one named authority and an exclusion boundary.
- Identity, props, voice, subject count, wardrobe, screen geography, and source-master ownership cannot swap.
- Timing is realistic, consecutive, and within the active duration limit.
- Dialogue fits its time budget and is assigned to one speaker.
- Camera, acting, light, sound, and negatives do not contradict the references.
- An edit names one master, one exact target, and its preserved content.

Return a brief `Reference map` for two or more assets, then one final prompt in a single plain-text code block. Include assumptions only when they matter. Never claim a job, result, URL, or file exists unless it was actually created.
