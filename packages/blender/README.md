# @av/blender

Reusable **Blender 4.2–4.x and 5.2.x LTS** scene creation and background rendering. TypeScript owns jobs/processes; Python runs **inside Blender**.
No studio imports, cloud-rendering dependency, add-on installation or MCP server.

- `scene.create`: reviewed `bpy` script → editable, image-packed `.blend`.
- `scene.render`: saved `.blend` → PNG preview or PNG sequence + silent MP4.
- Eevee and Cycles; explicit CPU/GPU selection for Cycles, no fallback.
- Keyframes, Geometry Nodes, Asset Browser marking via normal Blender Python.
- Poly Haven metadata search and bounded, checksum-verified CC0 downloads.
- Exclusive attempt directories, source hashes, logs, cancellation and timeouts.

## Setup

Install Blender **5.2 LTS** (or 4.5 LTS) from Blender's official distribution and
FFmpeg with libx264. Other 5.x release families and future major versions are
rejected until compatibility is tested. Set `BLENDER_BIN` to the executable if not on PATH. The standard macOS
application path is also detected. `FFMPEG_BIN` optionally overrides FFmpeg.
This adapter uses Blender's bundled Python and `bpy`; no pip installation is
needed. A standalone `bpy` distribution can run without a separate Blender app on
supported platforms, but it bundles Blender functionality and is **not** the
execution backend used here.

From this package directory, after the workspace's `bun install`:

```bash
npm run cli -- --probe
npm test                 # fake-process tests; no Blender needed
npm run test:live        # actual Eevee/Cycles + Geometry Nodes smoke test
```

In video-studio: `npm run compose -- --profile=blender`, then `npm run doctor`.
The `full` and `studio` profiles also include Blender. Other profiles remain
unchanged. The agent exposes `pva_blender_probe`, `pva_blender_create_scene`,
`pva_blender_render` and `pva_poly_haven`; load the `blender-scene` skill.

From the repository root, `npm run smoke:blender` exercises the **real registered
workspace and Blender tool handlers**, without mocks or an LLM/browser session.
It creates a fresh `studio-tests/blender-smoke` episode, builds the bundled scene,
then renders both engines and a two-second Eevee animation. Artifacts, tool-call
records and technical QA remain in the episode; it does not approve publication.

**Live verified on Blender 5.2.1 LTS / macOS:** scene creation, Geometry Nodes,
asset marking, layered-action keyframes, Eevee/Cycles stills, 48-frame MP4 and full
video decoding. Blender 5 uses `BLENDER_EEVEE` and action slot/channel bags; 4.x
compatibility paths remain in place. This is not a claim that every Blender
feature or GPU backend has been exercised.

## Standalone workflow

Create `request.json` (paths relative to the process working directory):

```json
{
  "mode": "create",
  "scriptPath": "examples/orbit.py",
  "outputDir": "/tmp/av-blender-build-001",
  "trustedInput": true,
  "settings": { "frameStart": 1, "frameEnd": 48, "fps": 24 }
}
```

```bash
npm run cli -- request.json
```

The bundled example builds a lit product scene, keyframes a torus, creates a
Geometry Nodes ring and marks reusable material/node assets. Read it before
executing. The worker saves `scene.blend`; the script should only build the scene.
Script globals `AV_INPUT_DIR` and `AV_OUTPUT_DIR` are available for asset paths.

Preview the saved source using another request:

```json
{
  "mode": "preview",
  "blendPath": "/tmp/av-blender-build-001/scene.blend",
  "outputDir": "/tmp/av-blender-preview-001",
  "trustedInput": true,
  "settings": { "engine": "eevee", "width": 640, "height": 360, "frameStart": 24 }
}
```

For final animation use `mode: "animation"`, a fresh output directory and
**explicit** settings, for example:

```json
{
  "engine": "cycles", "device": "cpu", "width": 1920, "height": 1080,
  "fps": 24, "frameStart": 1, "frameEnd": 48, "samples": 128, "seed": 7
}
```

Programmatic API:

```ts
import { runBlender } from '@av/blender';
const result = await runBlender(request, {
  timeoutMs: 3_600_000,
  signal: abortController.signal,
});
// result: outputDir, manifestPath, blendPath, mediaPath?, frameCount
```

Defaults: Eevee, 640×360, 24 FPS, inclusive frames 1–48, 32 samples, seed 0.
Preview renders `frameStart`. Frame count / FPS is the exact intended duration.
Settings override the source scene; existing compositor and sequencer are
**disabled**. This is a shot renderer, not a full Blender video-editor renderer.
Eevee manages its graphics context; `device: cpu` does not make Eevee CPU-only.
GPU backend selection applies to Cycles. Use CPU Cycles explicitly if Eevee
cannot initialize on a headless machine. No silent switch is made.

## Outputs and handoff

Each attempt contains `manifest.json`, `request.json`, `blender.log`,
`scene-info.json`, `scene.blend`, plus `source.py` for builds. Render attempts add
`preview.png` or `frames/000001.png`… plus `animation.mp4` and `encode.log`.

The manifest records running/completed/failed/cancelled status, source/worker
SHA-256, Blender version, settings, scene inventory and output hashes. A zero
exit without expected files is failure. Failed attempts retain logs/frames.
Attempts never overwrite an existing directory; retry into a new one.

An artist can open the `.blend`, edit it, **Save As** a new revision, and submit
that file for another preview/render. The original input file is not saved over.
Concurrent source saves are detected by comparing its hash before/after work.
Image files are packed, but linked libraries and non-image caches remain external;
`scene-info.json` inventories linked libraries. For a portable handoff, append
assets and keep all simulation/volume/font dependencies. Keep `asset.json`
provenance receipts with the source project.

Asset Browser uses ordinary Blender assets: `data_block.asset_mark()`, asset
metadata, and saved `.blend` files in an artist-configured asset-library folder.
No global preferences are modified by this package.

## Poly Haven

```ts
import { searchAssets, assetFiles, downloadAsset } from '@av/blender/poly-haven';
const assets = await searchAssets('hdris', 'sunset', signal);
const files = await assetFiles('venice_sunset', signal);
const asset = await downloadAsset('venice_sunset', 'hdri.1k.hdr', '/tmp/hdr-001', {
  maxBytes: 32 * 1024 * 1024, signal,
});
```

Select exact keys returned by `assetFiles` (resolution/format are not guessed).
Only HTTPS `dl.polyhaven.org` downloads are allowed, redirects rejected, maximum
256 MiB by default, with a five-minute acquisition deadline. Download receipts
record CC0-1.0, source URL, upstream MD5 verification when supplied, SHA-256 and
bytes. Search/files helpers accept an AbortSignal; callers should supply a deadline.
Models may need **multiple files**: inspect dependencies, download them explicitly
and relink images; this API does not automatically reconstruct model packages.
CC0 provenance does not license unrelated assets mixed into a scene.

## Safety and limitations

`trustedInput: true` acknowledges local trust, **not** human approval. Blender is
started with factory settings, `--disable-autoexec`, and
`--python-exit-code 1`; `.blend` loading uses `use_scripts=False`. Explicit Python
still has full host permissions. Review scripts and assets; use an isolated
OS/container worker for untrusted inputs. Do not enable auto-run to fix drivers.

- Async rendering/encoding is cancellable; POSIX process groups receive SIGTERM
  then SIGKILL after two seconds. Version probes have a ten-second timeout.
- The timeout applies per render/encode process, not a total episode budget.
- No durable worker daemon, frame-resume, render farm or simulation baking yet.
- Reproducibility metadata is not a promise of bit-identical GPU renders.
- MP4 has no audio; add sound/captions via a separate compositor. Decoding,
  visual review and delivery QA remain caller responsibilities.
- The first version is a **Pi-directed shot workflow**, not a claim that the
  legacy gateway can autonomously execute arbitrary Blender stages.

Official references: [Python API](https://docs.blender.org/api/4.5/),
[CLI](https://docs.blender.org/manual/en/4.5/advanced/command_line/arguments.html),
[Poly Haven API](https://api.polyhaven.com/), [CC0 terms](https://polyhaven.com/license).
