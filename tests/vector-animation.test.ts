import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseVectorAnimationSpec,
  renderVectorAnimation,
  renderVectorSvg,
  type VectorAnimationSpec,
} from "../src/vector-animation.js";

const outputs: string[] = [];
afterEach(async () => {
  await Promise.all(outputs.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function spec(durationInFrames = 24): VectorAnimationSpec {
  return {
    version: 1,
    name: "Rig test",
    width: 320,
    height: 568,
    fps: 24,
    durationInFrames,
    background: "#F5E6D3",
    nodes: [
      { id: "worm", x: 40, y: 200 },
      { id: "body", parent: "worm", shape: { type: "ellipse", cx: 0, cy: 0, rx: 22, ry: 50, fill: "#C96E3D" } },
      { id: "eye", parent: "worm", zIndex: 1, shape: { type: "ellipse", cx: 7, cy: -20, rx: 4, ry: 6, fill: "#111111" } },
    ],
    tracks: [{
      target: "worm",
      property: "x",
      keyframes: [
        { frame: 0, value: 40, easing: "ease-in" },
        { frame: durationInFrames - 1, value: 260 },
      ],
    }],
  };
}

describe("vector animation", () => {
  it("validates rig hierarchy and renders deterministic SVG", () => {
    const value = parseVectorAnimationSpec(spec());
    const svg = renderVectorSvg(value, 12, 0.5);
    expect(svg).toContain('width="160" height="284"');
    expect(svg).toContain('id="worm"');
    expect(svg).toContain("<ellipse");
  });

  it("rejects unsafe SVG path data and cyclic rigs", () => {
    const unsafe = spec();
    unsafe.nodes[1]!.shape = { type: "path", d: "M0 0<script>", fill: "#000000" };
    expect(() => parseVectorAnimationSpec(unsafe)).toThrow(/unsafe/);

    const cyclic = spec();
    cyclic.nodes[0]!.parent = "body";
    expect(() => parseVectorAnimationSpec(cyclic)).toThrow(/cycle/);
  });

  it("renders a short MP4 through ImageMagick and FFmpeg", async () => {
    const root = await mkdtemp(join(tmpdir(), "pva-vector-"));
    outputs.push(root);
    const outputPath = join(root, "test.mp4");
    const result = await renderVectorAnimation({ spec: spec(2), outputPath, renderScale: 0.25 });
    expect(result.frames).toBe(2);
    expect(result.width).toBe(80);
    const bytes = await readFile(outputPath);
    expect(bytes.length).toBeGreaterThan(1000);
  }, 30_000);
});
