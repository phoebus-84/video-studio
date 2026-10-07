// Spec-driven episodes on disk, made from @studio/series's fixtures: a
// poetry-short episode (the contracts' example release copied into the
// series, the fixture's spec, two narration takes with their word timing,
// three images) and the dentro-i-versi-short golden San Martino. Media are
// small placeholder files unless the caller writes real ones.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");
const DIV_INPUT = require.resolve("@studio/series/fixtures/dentro-i-versi-short/1.0.0/input.json");

export const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export interface SpecEpisodeOptions {
  /** Write the image at `path` (absolute); placeholder bytes by default. */
  image?: (path: string, assetId: string) => void;
  /** Write the take's audio at `path` (absolute), `seconds` long; placeholder bytes by default. */
  audio?: (path: string, take: string, seconds: number) => void;
}

/** Lay out a complete poetry-short episode at `episodeDir` (…/series/<series>/episodes/<episode>). */
export function specEpisode(
  episodeDir: string,
  episodeRef: { channel: string; series: string; episode: string },
  options: SpecEpisodeOptions = {},
): void {
  layOut(episodeDir, episodeRef, INPUT, RELEASE, "poetry-short", options);
}

export interface DivShortEpisodeOptions extends SpecEpisodeOptions {
  /** Write the sound at `path` (absolute); placeholder bytes by default. */
  sound?: (path: string, assetId: string) => void;
}

/**
 * Lay out the dentro-i-versi-short golden episode — a synthetic San Martino:
 * its release, spec, two takes with their word timing and energy, every
 * picture and sound the spec names — at `episodeDir`.
 */
export function divShortEpisode(
  episodeDir: string,
  episodeRef: { channel: string; series: string; episode: string },
  options: DivShortEpisodeOptions = {},
): void {
  layOut(episodeDir, episodeRef, DIV_INPUT, join(dirname(DIV_INPUT), "release"), "dentro-i-versi-short", options);
}

function layOut(
  episodeDir: string,
  episodeRef: { channel: string; series: string; episode: string },
  inputPath: string,
  release: string,
  templateId: string,
  options: DivShortEpisodeOptions,
): void {
  const input = JSON.parse(readFileSync(inputPath, "utf-8"));
  const seriesDir = dirname(dirname(episodeDir));
  const write = (relative: string, content: string | Buffer) => {
    mkdirSync(dirname(join(episodeDir, relative)), { recursive: true });
    writeFileSync(join(episodeDir, relative), content);
  };

  cpSync(release, join(seriesDir, "templates", templateId, input.template.version), { recursive: true });

  // Every picture and sound the fixture names, by its asset id.
  for (const [id, asset] of Object.entries<{ path: string; kind: string }>(input.assets)) {
    const path = join(episodeDir, asset.path);
    mkdirSync(dirname(path), { recursive: true });
    if (id.startsWith("image-")) {
      if (options.image) options.image(path, id.slice(6));
      else writeFileSync(path, `image ${id.slice(6)}`);
    } else if (id.startsWith("sound-")) {
      if (options.sound) options.sound(path, id.slice(6));
      else writeFileSync(path, `sound ${id.slice(6)}`);
    }
  }

  // Each take's audio, then its timing (bound to that audio's real hash),
  // then takes.json (bound to both).
  for (const take of input.narration.takes as any[]) {
    const path = join(episodeDir, take.audio.path);
    mkdirSync(dirname(path), { recursive: true });
    if (options.audio) options.audio(path, take.id, take.audio.durationSeconds);
    else writeFileSync(path, `audio ${take.id}`);
    take.audio.hash = sha256(readFileSync(path));
    const timing = { ...input.timings[take.id], audio: { ...take.audio } };
    const timingText = `${JSON.stringify(timing, null, 2)}\n`;
    write(take.timing.path, timingText);
    take.timing.hash = sha256(timingText);
  }
  write("artifacts/narration/takes.json", `${JSON.stringify(input.narration, null, 2)}\n`);
  write("episode-spec.json", `${JSON.stringify({ ...input.spec, episodeRef }, null, 2)}\n`);
}

/** Read, change and rewrite the episode's spec (a person editing it). */
export function editSpec(episodeDir: string, change: (spec: any) => void): void {
  const path = join(episodeDir, "episode-spec.json");
  const spec = JSON.parse(readFileSync(path, "utf-8"));
  change(spec);
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`);
}
