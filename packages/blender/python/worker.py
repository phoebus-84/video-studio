"""Trusted Blender 4.2–4.x / 5.2.x background worker. Runs inside Blender."""
import json
import os
from pathlib import Path
import runpy
import sys

import bpy


def main():
    cfg = json.loads(Path(sys.argv[sys.argv.index("--") + 1]).read_text())
    out = Path(cfg["outputDir"])
    settings = cfg["settings"]
    if not ((4, 2, 0) <= bpy.app.version < (5, 0, 0) or bpy.app.version[:2] == (5, 2)):
        raise RuntimeError("Use Blender 4.2–4.x or 5.2.x LTS")
    if cfg.get("blendPath"):
        bpy.ops.wm.open_mainfile(filepath=cfg["blendPath"], use_scripts=False)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    if cfg.get("scriptPath"):
        runpy.run_path(cfg["scriptPath"], run_name="__main__", init_globals={
            "AV_INPUT_DIR": cfg["inputDir"], "AV_OUTPUT_DIR": str(out),
        })

    scene = bpy.context.scene
    if scene.camera is None or scene.camera.type != "CAMERA":
        raise RuntimeError("Scene must have an active camera")
    eevee_engine = "BLENDER_EEVEE" if bpy.app.version >= (5, 0, 0) else "BLENDER_EEVEE_NEXT"
    scene.render.engine = "CYCLES" if settings["engine"] == "cycles" else eevee_engine
    if settings["engine"] == "cycles":
        scene.cycles.samples = settings["samples"]
        scene.cycles.seed = settings["seed"]
        scene.cycles.use_animated_seed = False
        scene.cycles.use_denoising = True
        device = settings["device"]
        scene.cycles.device = "CPU"
        if device != "cpu":
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = device.upper()
            prefs.get_devices()
            found = False
            for d in prefs.devices:
                d.use = d.type == device.upper()
                found = found or d.use
            if not found:
                raise RuntimeError(f"Requested Cycles device {device} unavailable; no fallback")
            scene.cycles.device = "GPU"
    else:
        scene.eevee.taa_render_samples = settings["samples"]

    scene.render.resolution_x = settings["width"]
    scene.render.resolution_y = settings["height"]
    scene.render.resolution_percentage = 100
    scene.render.fps = settings["fps"]
    scene.render.fps_base = 1.0
    scene.frame_start = settings["frameStart"]
    scene.frame_end = settings["frameEnd"]
    scene.frame_step = 1
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    # The output contract is the active scene, not a source file's sequencer.
    scene.render.use_sequencer = False
    scene.render.use_compositing = False
    scene.frame_set(scene.frame_start)

    missing = []
    dependencies = []
    for image in bpy.data.images:
        if image.source == "FILE" and not image.packed_file and image.filepath:
            image.filepath = bpy.path.abspath(image.filepath, library=image.library)
            dependencies.append(image.filepath)
            if not os.path.isfile(image.filepath):
                missing.append(image.filepath)
    for lib in bpy.data.libraries:
        lib.filepath = bpy.path.abspath(lib.filepath)
        dependencies.append(lib.filepath)
        if not os.path.isfile(lib.filepath):
            missing.append(lib.filepath)
    if missing:
        raise RuntimeError(f"Missing dependencies: {missing}")
    # Pack images for an editable handoff. Linked libraries and simulation caches
    # remain external and are listed; users should append assets for portability.
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "scene.blend"), check_existing=False)
    info = {
        "blenderVersion": bpy.app.version_string,
        "engine": scene.render.engine,
        "camera": scene.camera.name,
        "objects": sorted(o.name for o in scene.objects),
        "geometryNodeGroups": sorted(n.name for n in bpy.data.node_groups if n.bl_idname == "GeometryNodeTree"),
        "dependencies": dependencies,
        "externalLibraries": [lib.filepath for lib in bpy.data.libraries],
        "colorManagement": {"viewTransform": scene.view_settings.view_transform,
                            "look": scene.view_settings.look, "exposure": scene.view_settings.exposure},
        "frameStart": scene.frame_start, "frameEnd": scene.frame_end,
        "fps": scene.render.fps,
    }
    (out / "scene-info.json").write_text(json.dumps(info, indent=2))
    if cfg["mode"] == "preview":
        scene.render.filepath = str(out / "preview.png")
        bpy.ops.render.render(write_still=True)
    elif cfg["mode"] == "animation":
        (out / "frames").mkdir()
        # Explicit stepping also works with keyframes and Geometry Nodes. Bake
        # stateful simulations separately; random access is not a simulation bake.
        for frame in range(scene.frame_start, scene.frame_end + 1):
            scene.frame_set(frame)
            scene.render.filepath = str(out / "frames" / f"{frame:06d}.png")
            bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
