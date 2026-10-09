// Spec-driven episodes on disk, made from @studio/series's fixtures: a
// poetry-short episode (the contracts' example release copied into the
// series, the fixture's spec, two narration takes with their word timing,
// three images). Media are small placeholder files unless the caller writes
// real ones.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { signReceipt } from "@studio/contracts/src/receipt.mjs";
import { buildSheetReview, LAYOUT_SHEET_REPORT, SHEET_REVIEW_PATH } from "@studio/contracts/src/sheet-reviews.mjs";
import { inventory } from "@studio/contracts/src/source-pins.mjs";
import { sealTemplateCode } from "./template-code.js";

const require = createRequire(import.meta.url);
const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
const INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");
/** poetry-short@1.0.0's compiler and validator as a release's own code (avg-d1x). */
const RELEASE_CODE = dirname(require.resolve("@studio/series/fixtures/release-code/poetry-short/compiler/index.ts"));

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

function layOut(
  episodeDir: string,
  episodeRef: { channel: string; series: string; episode: string },
  inputPath: string,
  release: string,
  templateId: string,
  options: SpecEpisodeOptions & { sound?: (path: string, assetId: string) => void },
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

/**
 * Sign an approval of the episode's sheet as it is on disk, as
 * `vpr sheet approve` does, with a test key (avg-3th.2). Returns the review.
 */
export function approveSheet(episodeDir: string, episodeRef: { channel: string; series: string; episode: string }, key = "test-operator-key", decision: "approved" | "rejected" = "approved", note?: string): unknown {
  const reportBytes = readFileSync(join(episodeDir, LAYOUT_SHEET_REPORT));
  const report = JSON.parse(reportBytes.toString("utf-8"));
  const review = signReceipt(buildSheetReview({
    episode: `${episodeRef.channel}/${episodeRef.series}/${episodeRef.episode}`,
    inputsHash: report.inputsHash,
    sheet: { path: report.sheet.path, hash: report.sheet.hash },
    report: { path: "sheet.json", hash: sha256(reportBytes) },
    decision,
    ...(note !== undefined ? { note } : {}),
  }), key);
  writeFileSync(join(episodeDir, SHEET_REVIEW_PATH), `${JSON.stringify(review, null, 2)}\n`);
  return review;
}


/**
 * specEpisode, with its release running its own code (avg-d1x): the
 * poetry-short compiler and validator copied into the release as source and
 * sealed, the spec pinned to the sealed release. Returns the release's
 * directory and its manifest's hash.
 */
export async function releaseCodeEpisode(
  episodeDir: string,
  episodeRef: { channel: string; series: string; episode: string },
  options: SpecEpisodeOptions = {},
): Promise<{ releaseDir: string; hash: string }> {
  specEpisode(episodeDir, episodeRef, options);
  const seriesDir = dirname(dirname(episodeDir));
  const releaseDir = join(seriesDir, "templates", "poetry-short", "1.0.0");
  cpSync(dirname(RELEASE_CODE), releaseDir, { recursive: true });
  // Sealing refuses a pinned release: the spec steps aside while it is sealed, then pins the sealed one.
  const spec = join(episodeDir, "episode-spec.json");
  renameSync(spec, `${spec}.aside`);
  const sealed = await sealTemplateCode(seriesDir, "poetry-short", "1.0.0");
  renameSync(`${spec}.aside`, spec);
  editSpec(episodeDir, (doc) => { doc.template.hash = sealed.hash; });
  return { releaseDir, hash: sealed.hash };
}
