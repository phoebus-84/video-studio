import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blenderEpisodePath, registerBlenderTools } from "../src/blender-tools.js";

const ref = { channel: "channel", series: "series", episode: "episode" };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "blender-path-")); roots.push(root);
  const episode = join(root, "channel/series/series/episodes/episode");
  await mkdir(episode, { recursive: true });
  return { root, episode };
}
describe("Blender studio adapter", () => {
  it("registers separate create/render/probe/acquisition tools", () => {
    const registerTool = vi.fn();
    registerBlenderTools({ registerTool } as never);
    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      "pva_blender_probe", "pva_blender_create_scene", "pva_blender_render", "pva_poly_haven",
    ]);
  });
  it("uses canonical layout and checks new parent paths, including symlinks", async () => {
    const { root, episode } = await fixture();
    expect(await blenderEpisodePath(root, ref, "@assets/blender/a/new")).toBe(join(episode, "assets/blender/a/new"));
    await writeFile(join(root, "outside.py"), "print('no')");
    await symlink(root, join(episode, "escape"));
    await expect(blenderEpisodePath(root, ref, "escape/outside.py")).rejects.toThrow(/escapes episode/);
    await expect(blenderEpisodePath(root, ref, "escape/new/file")).rejects.toThrow(/escapes episode/);
    await symlink(join(root, "absent"), join(episode, "dangling"));
    await expect(blenderEpisodePath(root, ref, "dangling/new")).rejects.toThrow(/Dangling/);
    await expect(blenderEpisodePath(root, ref, "../sibling/file")).rejects.toThrow();
    await expect(blenderEpisodePath(root, ref, "/tmp/a.py")).rejects.toThrow(/relative/);
    await expect(blenderEpisodePath(root, { ...ref, channel: "../bad" }, "a.py")).rejects.toThrow();
  });
});
