import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { artifactExists } from "../../../src/artifacts/discovery.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vpr-artifacts-"));
  roots.push(root);
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  await mkdir(path.join(root, "assets", "animation"), { recursive: true });
  await mkdir(path.join(root, "output"), { recursive: true });
  return root;
}

describe("artifact discovery", () => {
  it("recognizes provider-neutral editorial and animation outputs", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "artifacts", "visual-beats.json"), "{}\n");
    await writeFile(path.join(root, "assets", "animation", "visuals.mp4"), "media");
    expect(artifactExists(root, "visual-beats.json")).toBe(true);
    expect(artifactExists(root, "animated-visuals.mp4")).toBe(true);
  });

  it("resolves immutable final media through output/current.json", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "output", "render-1.mp4"), "media");
    await writeFile(path.join(root, "output", "current.json"), JSON.stringify({ renderId: "render-1", path: "render-1.mp4" }));
    expect(artifactExists(root, "final-video.mp4")).toBe(true);
  });

  it("rejects a traversal pointer", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "output", "current.json"), JSON.stringify({ path: "../outside.mp4" }));
    expect(artifactExists(root, "final-video.mp4")).toBe(false);
  });
});
