// ---------------------------------------------------------------------------
// The pipeline the library declares for an episode (avg-sxk)
// ---------------------------------------------------------------------------
// An episode's pipeline is the `pipeline:` key of a `pipeline.yaml` in the
// episode, else its series, else its channel. The first file that names one
// wins. A file that doesn't parse, or names something that isn't a pipeline
// id, is an error naming the file: guessing past it would run another
// pipeline's stages on the episode.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { channelPath, episodePath, seriesPath } from "@studio/contracts/src/layout.mjs";

export interface DeclaredPipeline {
  /** The pipeline id. */
  name: string;
  /** The declaring file, relative to the library root. */
  file: string;
}

export class PipelineDeclarationError extends Error {
  constructor(
    readonly code: "bad-declaration" | "bad-name",
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = "PipelineDeclarationError";
  }
}

const PIPELINE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function declaredPipeline(
  libraryRoot: string,
  ref: { channel: string; series: string; episode: string },
): DeclaredPipeline | null {
  const dirs = [
    episodePath(libraryRoot, ref.channel, ref.series, ref.episode),
    seriesPath(libraryRoot, ref.channel, ref.series),
    channelPath(libraryRoot, ref.channel),
  ];
  for (const dir of dirs) {
    const absolute = path.join(dir, "pipeline.yaml");
    const file = path.relative(libraryRoot, absolute);
    let raw: string;
    try {
      raw = readFileSync(absolute, "utf-8");
    } catch {
      continue;
    }
    // An empty or comment-only file declares nothing (js-yaml 5 refuses an empty document).
    if (!raw.split("\n").some((line) => line.trim() !== "" && !line.trim().startsWith("#"))) continue;
    let doc: unknown;
    try {
      doc = loadYaml(raw);
    } catch (e) {
      throw new PipelineDeclarationError("bad-declaration", `${file} does not parse: ${e instanceof Error ? e.message : String(e)}`, file);
    }
    if (doc === null || doc === undefined) continue;
    if (typeof doc !== "object" || Array.isArray(doc)) {
      throw new PipelineDeclarationError("bad-declaration", `${file} is not a mapping`, file);
    }
    const name = (doc as Record<string, unknown>).pipeline;
    if (name === undefined || name === null) continue;
    if (typeof name !== "string" || !PIPELINE_ID.test(name)) {
      throw new PipelineDeclarationError("bad-name", `${file} declares pipeline ${JSON.stringify(name)}, which is not a pipeline id`, file);
    }
    return { name, file };
  }
  return null;
}
