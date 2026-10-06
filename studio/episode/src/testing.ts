// A spec-driven episode on disk, made from @studio/series's poetry-short
// fixture: the contracts' example release copied into the series, the
// fixture's spec, two narration takes with their word timing, three images.
// Media are small placeholder files unless the caller writes real ones.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");

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
  const input = JSON.parse(readFileSync(INPUT, "utf-8"));
  const seriesDir = dirname(dirname(episodeDir));
  const write = (relative: string, content: string | Buffer) => {
    mkdirSync(dirname(join(episodeDir, relative)), { recursive: true });
    writeFileSync(join(episodeDir, relative), content);
  };

  cpSync(RELEASE, join(seriesDir, "templates", "poetry-short", "1.0.0"), { recursive: true });

  for (const panel of input.spec.data.panels as { assetId: string }[]) {
    const path = join(episodeDir, "assets", "images", `${panel.assetId}.png`);
    mkdirSync(dirname(path), { recursive: true });
    if (options.image) options.image(path, panel.assetId);
    else writeFileSync(path, `image ${panel.assetId}`);
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
