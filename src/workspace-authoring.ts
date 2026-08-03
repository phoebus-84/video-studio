// ---------------------------------------------------------------------------
// Filesystem workspace authoring
// ---------------------------------------------------------------------------
// Creates channels, series, and episodes in the canonical library. Operations
// are idempotent, never overwrite existing metadata, and only accept safe slug
// components so all writes remain below the configured library root.
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { load as loadYaml } from "js-yaml";
import { resolveConfig } from "./config.js";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface WorkspaceCreateResult {
  kind: "channel" | "series" | "episode";
  slug: string;
  path: string;
  createdFiles: string[];
  existingFiles: string[];
}

export interface CreateChannelInput {
  slug: string;
  title: string;
  description: string;
  pipelineYaml?: string;
}

export interface CreateSeriesInput extends CreateChannelInput {
  channel: string;
}

export interface CreateEpisodeInput {
  channel: string;
  series: string;
  slug: string;
  title: string;
  description: string;
  episodeRequest?: string;
  pipelineYaml?: string;
}

function validateSlug(label: string, value: string): void {
  if (!SLUG_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase kebab-case slug of 1-64 characters`);
  }
}

function validateText(label: string, value: string, max: number): void {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must not be empty`);
  if (trimmed.length > max) throw new Error(`${label} exceeds ${max} characters`);
}

function validatePipelineYaml(value: string | undefined): void {
  if (value === undefined) return;
  const parsed = loadYaml(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("pipelineYaml must contain a YAML mapping");
  }
}

function assertContained(root: string, target: string): void {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("Workspace path escapes the configured library root");
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await readFile(target);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return code === "EISDIR";
    throw error;
  }
}

async function writeExclusive(
  root: string,
  target: string,
  content: string,
  result: WorkspaceCreateResult,
): Promise<void> {
  assertContained(root, target);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, content, { encoding: "utf-8", flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY });
    result.createdFiles.push(path.relative(root, target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    result.existingFiles.push(path.relative(root, target));
  }
}

function markdownDocument(title: string, description: string): string {
  return `# ${title.trim()}\n\n${description.trim()}\n`;
}

function jsonDocument(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function createWorkspaceContract(
  root: string,
  dir: string,
  kind: "channel" | "series" | "episode",
  title: string,
  description: string,
  result: WorkspaceCreateResult,
): Promise<void> {
  const now = new Date().toISOString();
  await writeExclusive(root, path.join(dir, ".workspace", "contract.json"), jsonDocument({
    schema: "video-workspace-contracts/workspace-v1",
    version: "0.1.0",
    type: kind,
    createdAt: now,
    updatedAt: now,
  }), result);
  await writeExclusive(root, path.join(dir, ".workspace", "metadata.json"), jsonDocument({
    title: title.trim(),
    description: description.trim(),
    createdAt: now,
    updatedAt: now,
  }), result);
}

export async function createChannelWorkspace(input: CreateChannelInput, libraryRoot?: string): Promise<WorkspaceCreateResult> {
  validateSlug("Channel slug", input.slug);
  validateText("Channel title", input.title, 120);
  validateText("Channel description", input.description, 2000);
  validatePipelineYaml(input.pipelineYaml);

  const root = libraryRoot ?? (await resolveConfig()).libraryRoot;
  const dir = path.join(root, input.slug);
  assertContained(root, dir);
  await mkdir(dir, { recursive: true });

  const result: WorkspaceCreateResult = {
    kind: "channel",
    slug: input.slug,
    path: dir,
    createdFiles: [],
    existingFiles: [],
  };

  await writeExclusive(root, path.join(dir, "channel.json"), jsonDocument({
    version: 1,
    slug: input.slug,
    title: input.title.trim(),
    description: input.description.trim(),
  }), result);
  await writeExclusive(root, path.join(dir, "README.md"), markdownDocument(input.title, input.description), result);
  await createWorkspaceContract(root, dir, "channel", input.title, input.description, result);
  const now = new Date().toISOString();
  await writeExclusive(root, path.join(dir, "channel.md"), `---\nchannelId: ${input.slug}\ntitle: ${input.title.trim()}\ncreatedAt: ${now}\n---\n`, result);
  await writeExclusive(root, path.join(dir, "settings.yaml"), `# Channel settings for ${input.slug}\n`, result);
  if (input.pipelineYaml !== undefined) {
    await writeExclusive(root, path.join(dir, "pipeline.yaml"), `${input.pipelineYaml.trim()}\n`, result);
  }

  return result;
}

export async function createSeriesWorkspace(input: CreateSeriesInput, libraryRoot?: string): Promise<WorkspaceCreateResult> {
  validateSlug("Channel slug", input.channel);
  validateSlug("Series slug", input.slug);
  validateText("Series title", input.title, 120);
  validateText("Series description", input.description, 4000);
  validatePipelineYaml(input.pipelineYaml);

  const root = libraryRoot ?? (await resolveConfig()).libraryRoot;
  const channelDir = path.join(root, input.channel);
  if (!(await pathExists(path.join(channelDir, "channel.json")))) {
    throw new Error(`Channel does not exist: ${input.channel}`);
  }

  const dir = path.join(channelDir, input.slug);
  assertContained(root, dir);
  await mkdir(path.join(dir, "skills"), { recursive: true });

  const result: WorkspaceCreateResult = {
    kind: "series",
    slug: `${input.channel}/${input.slug}`,
    path: dir,
    createdFiles: [],
    existingFiles: [],
  };

  await writeExclusive(root, path.join(dir, "series.json"), jsonDocument({
    version: 1,
    channel: input.channel,
    slug: input.slug,
    title: input.title.trim(),
    description: input.description.trim(),
  }), result);
  await writeExclusive(root, path.join(dir, "README.md"), markdownDocument(input.title, input.description), result);
  await createWorkspaceContract(root, dir, "series", input.title, input.description, result);
  const now = new Date().toISOString();
  await writeExclusive(root, path.join(dir, "series.md"), `---\nseriesId: ${input.slug}\ntitle: ${input.title.trim()}\ncreatedAt: ${now}\n---\n`, result);
  await writeExclusive(root, path.join(dir, "settings.yaml"), `# Series settings for ${input.slug}\n`, result);
  await writeExclusive(root, path.join(dir, "visual-bible.md"), `# Visual Bible for ${input.title.trim()}\n`, result);
  for (const relative of ["voice-profiles", "pipelines", "sources"]) {
    await mkdir(path.join(dir, relative), { recursive: true });
  }
  if (input.pipelineYaml !== undefined) {
    await writeExclusive(root, path.join(dir, "pipeline.yaml"), `${input.pipelineYaml.trim()}\n`, result);
  }

  return result;
}

export async function createEpisodeWorkspace(input: CreateEpisodeInput, libraryRoot?: string): Promise<WorkspaceCreateResult> {
  validateSlug("Channel slug", input.channel);
  validateSlug("Series slug", input.series);
  validateSlug("Episode slug", input.slug);
  validateText("Episode title", input.title, 120);
  validateText("Episode description", input.description, 4000);
  validatePipelineYaml(input.pipelineYaml);

  const root = libraryRoot ?? (await resolveConfig()).libraryRoot;
  const seriesDir = path.join(root, input.channel, input.series);
  if (!(await pathExists(path.join(seriesDir, "series.json")))) {
    throw new Error(`Series does not exist: ${input.channel}/${input.series}`);
  }

  const dir = path.join(seriesDir, input.slug);
  assertContained(root, dir);
  for (const relative of ["artifacts", "assets/animation", "assets/audio", "output", "production", "reviews"]) {
    await mkdir(path.join(dir, relative), { recursive: true });
  }

  const result: WorkspaceCreateResult = {
    kind: "episode",
    slug: `${input.channel}/${input.series}/${input.slug}`,
    path: dir,
    createdFiles: [],
    existingFiles: [],
  };

  await writeExclusive(root, path.join(dir, "episode.json"), jsonDocument({
    version: 1,
    channel: input.channel,
    series: input.series,
    slug: input.slug,
    title: input.title.trim(),
    description: input.description.trim(),
  }), result);
  await writeExclusive(root, path.join(dir, "artifacts", "episode.json"), jsonDocument({
    version: 1,
    title: input.title.trim(),
    description: input.description.trim(),
    scenes: [],
  }), result);
  await createWorkspaceContract(root, dir, "episode", input.title, input.description, result);
  const now = new Date().toISOString();
  await writeExclusive(root, path.join(dir, "episode.yaml"), `# Episode ${input.slug}\nslug: ${input.slug}\ntitle: ${input.title.trim()}\ncreatedAt: ${now}\n`, result);
  for (const relative of ["source", "prompts", "assets/images", "assets/graphics", "attempts", "journal"]) {
    await mkdir(path.join(dir, relative), { recursive: true });
  }
  await writeExclusive(root, path.join(dir, "assets", "manifest.json"), jsonDocument({
    apiVersion: "v1alpha1",
    kind: "AssetManifest",
    assets: [],
  }), result);
  await writeExclusive(root, path.join(dir, "reviews", "threads.jsonl"), "", result);
  await writeExclusive(root, path.join(dir, "journal", "events.jsonl"), "", result);
  await writeExclusive(root, path.join(dir, "output", "current.json"), jsonDocument({
    apiVersion: "v1alpha1",
    kind: "CurrentDeliverable",
    renderId: null,
  }), result);
  if (input.episodeRequest !== undefined) {
    await writeExclusive(root, path.join(dir, "artifacts", "episode-request.md"), `${input.episodeRequest.trim()}\n`, result);
  }
  if (input.pipelineYaml !== undefined) {
    await writeExclusive(root, path.join(dir, "pipeline.yaml"), `${input.pipelineYaml.trim()}\n`, result);
  }

  return result;
}
