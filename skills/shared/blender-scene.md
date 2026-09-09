---
name: blender-scene
version: "0.1.0"
description: Create editable Blender scenes and animations using bpy, background CLI, Eevee/Cycles, Geometry Nodes, Asset Browser and Poly Haven. Use for 3D shots, product animation, procedural worlds, preview/final rendering or artist-directed .blend handoffs.
---

# Blender scenes and animation

## Before production

1. Read `packages/blender/README.md` from the repository root. Run
   `pva_blender_probe`. Supported targets: **Blender 4.2–4.x and 5.2.x LTS**.
   Do not substitute a renderer or install Blender/add-ons without permission.
2. Establish the shot: subject, reference images, framing, camera/lens, scale,
   action beats, seconds, FPS, resolution, lighting, engine, render-time budget,
   asset provenance, and who directs/approves it. Use one named shot per scene.
3. Agree on intervention: automatic within an approved brief/budget, guided
   with preview approval, or manual with artist editing after each phase.
   Never treat `trustedInput: true` as evidence of human approval.
4. Save `artifacts/scene-plan.json` (for the `blender-animation` workflow):
   include `sceneId`, `direction`, `actionBeats`, `settings`, `assets`, `budget`,
   `intervention`, and `acceptanceCriteria`. Frame endpoints are **inclusive**;
   2 seconds at 24 FPS means frames 1–48, not 1–49.

## Build / revise

- Author readable Python under `artifacts/blender/<sceneId>/scene.py` using
  Blender's bundled Python (`bpy`, `mathutils`), not system-Python pip `bpy`.
- `pva_blender_create_scene` executes reviewed Python and saves an editable
  `scene.blend`. It accepts a starting `blendPath` for revisions. Paths are
  episode-relative. Each call writes a **new attempt**, never overwrites one.
- The script receives `AV_INPUT_DIR` and `AV_OUTPUT_DIR` strings. Resolve input
  assets against `AV_INPUT_DIR` or explicit approved paths. The worker controls
  saving/rendering: the script should build data, not spawn programs or render.
- Use data APIs (`bpy.data`, explicit collections and node links) where possible;
  operators require correct selection/context. Name objects/materials/cameras.
  Assign `bpy.context.scene.camera`. Prefer meters and explicit transforms.
- Set a deliberate color-management view (AgX for lit 3D, not an unexplained
  conversion from a 2D reference). Record view transform, look and exposure.
- Review Python before execution. Downloaded scripts, `.blend` text blocks,
  drivers, add-ons and dependencies are untrusted. Auto-execution is disabled,
  but this is **not a sandbox**; explicit Python has full host privileges.

### Animation and Geometry Nodes

Read `packages/blender/examples/orbit.py` as a small runnable starting point:
keyframed hero object, camera, lights, real Geometry Nodes graph, asset marking.

- Keyframe transforms, camera/lens and exposed modifier parameters. Specify
  interpolation; do not accept accidental easing or duplicate a loop endpoint.
- Blender 4.x node group interfaces use `group.interface.new_socket(...)`, not
  legacy `group.inputs.new`. Attach a `NODES` modifier to a host object, assign
  `node_group`, and connect a `NodeGroupOutput`. Instances are cheaper than
  realized meshes; realize only when needed for downstream operations.
- Expose artistic parameters (density, radius, speed, seed) rather than burying
  constants in scripts. Set random-node seeds separately from the Cycles seed.
- Use Scene Time or keyframed inputs for stateless procedural motion. Simulation
  zones, physics and external caches need an explicit bake/dependency plan;
  rendering a frame range is **not** a simulation bake. Keep caches with sources.
- Test Blender-version-sensitive APIs against the installed version. Blender
  5.2 uses `BLENDER_EEVEE` instead of `BLENDER_EEVEE_NEXT` and removes
  `Action.fcurves`: traverse action layers/strips and the object's slot channel
  bag. The bundled example handles both 4.x and 5.2; other 5.x families are not
  currently enabled.

### Asset Browser and Poly Haven

1. `pva_poly_haven` action `search`, then `files`, then `download` with an exact
   `fileKey` and byte budget. Prefer 1K/2K previews. Downloads are CC0 with an
   `asset.json` receipt recording source URL, time, bytes and SHA-256.
2. HDRIs: load with `bpy.data.images.load`, connect a ShaderNodeTexEnvironment
   to World Background Color. Texture PBR: base color in sRGB; roughness,
   normal and displacement as Non-Color; pass normals through ShaderNodeNormalMap.
3. Models: inspect listed dependencies. One `.blend` download does **not** imply
   that referenced textures are present. Download required files explicitly,
   retain their receipts, and relink images to the downloaded paths before build.
4. Append approved objects/collections/materials with
   `bpy.data.libraries.load(filepath, link=False)`; link loaded collections into
   the scene. Appending is more portable than external library links.
5. Mark reusable objects, materials or node groups with `asset_mark()`; populate
   `asset_data.description` and tags. Save that `.blend` in a dedicated asset
   library. In Blender Preferences → File Paths → Asset Libraries, the artist
   adds that folder, then browses it in Asset Browser. Do not silently change
   global Blender preferences. Catalogs are optional; no add-on is required.
6. The worker packs file images and reports linked libraries. Fonts, Alembic,
   VDB and simulation caches require manual dependency checking; packing is
   not a universal portability guarantee. Keep provenance beside the `.blend`.

## Preview → direct → final

- `pva_blender_render`, `mode: preview`, renders `frameStart` as PNG. For motion,
  render a low-res `animation`; inspect it and first/middle/last stills.
- Eevee is the fast preview choice but still needs a working GPU/display
  context on some headless machines. Cycles CPU is portable but slower.
  Cycles GPU backends (`metal`, `cuda`, `optix`, `hip`, `oneapi`) are explicit;
  an unavailable device fails instead of silently falling back.
- Defaults are 640×360, 24 FPS, 48 frames, 32 samples. **Final resolution,
  duration, engine, samples, seed and device must be explicit.** Input `.blend`
  render settings are overridden. Compositor and sequencer are disabled; this
  tool renders the active scene, not arbitrary Blender video edits.
- Record `artifacts/scene-source.json`: `sceneId`, episode-relative
  `manifestPath`, `blendPath`, and the manifest's `outputBlendSha256`.
- Guided/manual handoff: give the artist that file path; have them **Save As**
  `artifacts/blender/<sceneId>/artist-v002.blend`, never edit immutable attempts.
  Render the saved revision. A changed source invalidates preview approval.
- Record `artifacts/scene-preview.json`: accepted source path/hash, preview
  manifest/media paths, final settings, direction notes and actual reviewer
  decision. Do not invent an approval or proceed past a required gate.
- Final animation renders PNG frames before encoding a silent H.264/yuv420p
  MP4. Keep frames/logs on failure. Retry into another attempt; current adapter
  does not resume a partial frame range or reconnect after process death.
- Record `artifacts/scene-render.json` with selected manifest, source hash,
  media path and settings. Completion of a render is not deliverable acceptance.

## QA and mixed workflows

Measure MP4 with ffprobe: expected duration = frame count / FPS, even dimensions,
H.264, yuv420p and correct frame count. Decode and inspect representative frames
and playback: framing, clipping, missing textures, flicker, noise, motion speed,
loop seam and consistency with approved direction. Report what was actually
checked in `artifacts/scene-qa.json`; missing evidence is not a pass.

Use the returned MP4 as a **video clip**, alongside generated footage, Remotion
motion graphics, terminal recordings or stills in a typed edit timeline. Compose
narration/music/captions separately. Do not feed an animation into the legacy
still-image concat path. For a standalone silent shot, explicitly agree that
silence is intended and use shot-specific QA, not narrated-video requirements.

The manifest provides a Pi-directed workflow. The legacy gateway autopilot is
not a general scene executor. Autonomous tool execution is possible within an
approved scope, but durable policy-gated automation across arbitrary pipelines
still requires the harness work described in `docs/harness-review.md`.

## Official references

- [Blender Python API 4.5](https://docs.blender.org/api/4.5/)
- [Background command-line rendering](https://docs.blender.org/manual/en/4.5/advanced/command_line/render.html)
- [Command-line arguments](https://docs.blender.org/manual/en/4.5/advanced/command_line/arguments.html)
- [Geometry Nodes](https://docs.blender.org/manual/en/4.5/modeling/geometry_nodes/index.html)
- [Asset libraries](https://docs.blender.org/manual/en/4.5/editors/asset_browser.html)
- [Poly Haven API](https://api.polyhaven.com/) and [license](https://polyhaven.com/license)
