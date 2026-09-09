import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocked = vi.hoisted(() => ({ selected: true, run: vi.fn() }));
vi.mock("@av/blender", async importOriginal => ({
  ...await importOriginal<typeof import("@av/blender")>(), runBlender: mocked.run,
}));
vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readFile: (...args: Parameters<typeof original.readFile>) => {
    if (String(args[0]).endsWith("/composed.json")) return Promise.resolve(JSON.stringify({
      capabilities: mocked.selected ? { "scene.create": { provider: "blender" }, "scene.render": { provider: "blender" } } : {},
    }));
    return original.readFile(...args);
  } };
});
import { registerBlenderTools } from "../src/blender-tools.js";
const ref = { channel: "channel", series: "series", episode: "episode" };
let root: string;
let episode: string;
let previous: string | undefined;
beforeEach(async () => {
  mocked.selected = true; mocked.run.mockReset();
  root = await mkdtemp(join(tmpdir(), "blender-dispatch-"));
  previous = process.env.AVG_LIBRARY_ROOT; process.env.AVG_LIBRARY_ROOT = root;
  episode = join(root, "channel/series/series/episodes/episode");
  await mkdir(join(episode, "artifacts"), { recursive: true });
  await writeFile(join(episode, "artifacts", "scene.py"), "# bpy source");
  await writeFile(join(episode, "artifacts", "artist.blend"), "BLENDER source");
  mocked.run.mockImplementation(async request => ({
    outputDir: request.outputDir, blendPath: join(request.outputDir, "scene.blend"),
    manifestPath: join(request.outputDir, "manifest.json"), frameCount: 0,
  }));
});
afterEach(async () => {
  if (previous === undefined) delete process.env.AVG_LIBRARY_ROOT; else process.env.AVG_LIBRARY_ROOT = previous;
  await rm(root, { recursive: true, force: true });
});
function tools() {
  const all = new Map<string, any>();
  registerBlenderTools({ registerTool: (tool: any) => all.set(tool.name, tool) } as never);
  return all;
}
it("dispatches builds with canonical source/attempt paths and cancellation", async () => {
  const signal = new AbortController().signal;
  const update = vi.fn();
  await tools().get("pva_blender_create_scene").execute("call", { ...ref, sceneId: "shot-1",
    scriptPath: "artifacts/scene.py", trustedInput: true, settings: { engine: "eevee" } }, signal, update);
  const [request, options] = mocked.run.mock.calls[0]!;
  expect(request.scriptPath).toBe(join(episode, "artifacts", "scene.py"));
  expect(request.outputDir).toMatch(new RegExp("assets/blender/shot-1/[0-9a-f-]+$"));
  expect(request.mode).toBe("create"); expect(options.signal).toBe(signal);
  expect(update).toHaveBeenCalledOnce();
});
it("renders an artist-saved source without rerunning its build script", async () => {
  await tools().get("pva_blender_render").execute("call", { ...ref, sceneId: "shot-1",
    blendPath: "artifacts/artist.blend", mode: "animation", trustedInput: true,
    settings: { engine: "cycles", frameStart: 1, frameEnd: 48 } });
  expect(mocked.run.mock.calls[0]![0]).toMatchObject({ mode: "animation", blendPath: join(episode, "artifacts", "artist.blend") });
  expect(mocked.run.mock.calls[0]![0].scriptPath).toBeUndefined();
});
it("rejects an unselected binding before launching a provider", async () => {
  mocked.selected = false;
  await expect(tools().get("pva_blender_render").execute("call", { ...ref, sceneId: "shot-1",
    blendPath: "artifacts/artist.blend", mode: "preview", trustedInput: true })).rejects.toThrow(/not bound/);
  expect(mocked.run).not.toHaveBeenCalled();
});
