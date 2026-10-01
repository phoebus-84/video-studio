import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDefaultLoader, resolvePipeline } from "@studio/runtime";
import type { ResolvedPipeline, ResolvedStage, StageDefinition } from "@studio/runtime";

export const BUILTIN_PIPELINES = join(
  dirname(createRequire(import.meta.url).resolve("@studio/pipelines/package.json")),
  "pipelines",
);

export const BUILTIN_NAMES = readdirSync(BUILTIN_PIPELINES)
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => file.replace(/\.yaml$/, ""));

export async function builtin(name: string): Promise<ResolvedPipeline> {
  const library = await mkdtemp(join(tmpdir(), "adapters-library-"));
  try {
    return await resolvePipeline(createDefaultLoader(library, BUILTIN_PIPELINES), name);
  } finally {
    await rm(library, { recursive: true, force: true });
  }
}

export function stageOf(pipeline: ResolvedPipeline, id: string): ResolvedStage {
  const stage = pipeline.stages.find((candidate) => candidate.definition.id === id);
  if (!stage) throw new Error(`${pipeline.name} has no stage "${id}"`);
  return stage;
}

/** A ResolvedStage built by hand, for the matching rules in isolation. */
type StageShape = Partial<Omit<StageDefinition, "produces" | "consumes">> & {
  produces?: string[];
  consumes?: string[];
  capability?: string;
};

export function stage(over: StageShape): ResolvedStage {
  const { produces = [], consumes = [], capability, ...rest } = over;
  return {
    definition: {
      id: "s",
      name: "S",
      type: capability ? "capability" : "editorial",
      capabilities: capability ? [{ capability }] : [],
      dependsOn: [],
      produces: produces.map((label) => ({ kind: "json", label })),
      consumes: consumes.map((label) => ({ kind: "json", label })),
      gates: { autopilot: true, review: "none", retryOnFailure: 0 },
      ...rest,
    },
    source: "test",
    topoIndex: 0,
  };
}

const roots: string[] = [];

export async function episodeDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "adapters-episode-"));
  roots.push(root);
  const dir = join(root, "childrens", "series", "fairy-tales", "episodes", "ep");
  await mkdir(join(dir, "artifacts", "narration"), { recursive: true });
  await mkdir(join(dir, "assets", "images"), { recursive: true });
  return dir;
}

export async function cleanEpisodes(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

/** A real, readable 24 kHz mono 16-bit WAV of silence. */
export function wav(seconds: number): Buffer {
  const sampleRate = 24_000;
  const data = Buffer.alloc(Math.round(seconds * sampleRate) * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
