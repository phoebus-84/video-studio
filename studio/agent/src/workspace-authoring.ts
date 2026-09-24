// ---------------------------------------------------------------------------
// Filesystem workspace authoring
// ---------------------------------------------------------------------------
// Creates channels, series, and episodes in the canonical library. Operations
// are idempotent, never overwrite existing metadata, and only accept safe slug
// components so all writes remain below the configured library root.
//
// Every path here comes from `@studio/contracts/src/layout.mjs`. This file used
// to join its own — `channel/<series>` and `channel/<series>/<episode>`, the
// pre-migration layout — which put series loose in the channel directory and
// episodes loose in the series. Discovery looks under `series/` and
// `episodes/`, so a channel authored this way came back empty: the studio
// listed nothing while a finished episode sat on disk. Build paths with the
// helpers below and the two cannot drift again.
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { load as loadYaml } from "js-yaml";
import {
  channelPath,
  seriesPath,
  episodePath,
  CHANNEL_KNOWLEDGE,
  SERIES_KNOWLEDGE,
  SERIES_CONTAINER,
  EPISODES_CONTAINER,
  EPISODE_DIRECTORIES,
  EPISODE_SEED_FILES,
} from "@studio/contracts/src/layout.mjs";
import { EPISODE_MANIFEST_FILE, renderEpisodeManifest } from "@studio/contracts/src/episode-manifest.mjs";
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
  const dir = channelPath(root, input.slug);
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
  // The channel's own knowledge folders, plus the container its series live in.
  // `series/` is created up front so an empty channel still looks like Layout 2
  // rather than like a channel whose series happen to be missing.
  for (const relative of [...CHANNEL_KNOWLEDGE, SERIES_CONTAINER]) {
    await mkdir(path.join(dir, relative), { recursive: true });
  }
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
  const channelDir = channelPath(root, input.channel);
  if (!(await pathExists(path.join(channelDir, "channel.json")))) {
    throw new Error(`Channel does not exist: ${input.channel}`);
  }

  // `<root>/<channel>/series/<slug>` — inside the container, not beside the
  // channel's own knowledge folders.
  const dir = seriesPath(root, input.channel, input.slug);
  assertContained(root, dir);
  await mkdir(dir, { recursive: true });

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
  // Series knowledge folders, plus the container its episodes live in.
  for (const relative of [...SERIES_KNOWLEDGE, EPISODES_CONTAINER]) {
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
  const seriesDir = seriesPath(root, input.channel, input.series);
  if (!(await pathExists(path.join(seriesDir, "series.json")))) {
    throw new Error(`Series does not exist: ${input.channel}/${input.series}`);
  }

  // `<root>/<channel>/series/<series>/episodes/<slug>`.
  const dir = episodePath(root, input.channel, input.series, input.slug);
  assertContained(root, dir);
  for (const relative of EPISODE_DIRECTORIES) {
    await mkdir(path.join(dir, relative), { recursive: true });
  }

  const result: WorkspaceCreateResult = {
    kind: "episode",
    slug: `${input.channel}/${input.series}/${input.slug}`,
    path: dir,
    createdFiles: [],
    existingFiles: [],
  };

  await writeExclusive(root, path.join(dir, "artifacts", "episode.json"), jsonDocument({
    version: 1,
    title: input.title.trim(),
    description: input.description.trim(),
    scenes: [],
  }), result);
  await createWorkspaceContract(root, dir, "episode", input.title, input.description, result);
  const now = new Date().toISOString();
  await writeExclusive(root, path.join(dir, EPISODE_MANIFEST_FILE), renderEpisodeManifest({
    slug: input.slug,
    channel: input.channel,
    series: input.series,
    title: input.title.trim(),
    description: input.description.trim(),
    createdAt: now,
  }), result);
  for (const [relative, content] of Object.entries(EPISODE_SEED_FILES)) {
    await writeExclusive(root, path.join(dir, relative), content, result);
  }
  if (input.episodeRequest !== undefined) {
    await writeExclusive(root, path.join(dir, "artifacts", "episode-request.md"), `${input.episodeRequest.trim()}\n`, result);
  }
  if (input.pipelineYaml !== undefined) {
    await writeExclusive(root, path.join(dir, "pipeline.yaml"), `${input.pipelineYaml.trim()}\n`, result);
  }

  return result;
}
