// Archive and stock media in a workspace (avg-fe8.2): an episode or, later, a
// channel source. A fetched file lands in assets/images, assets/video or
// assets/sounds as <name>.<ext>, with <name>.source.json beside it naming its
// provider, item, licence and credit; the provider's response is kept in
// artifacts/provenance/<sha256>.json as evidence; ATTRIBUTIONS.md is made
// again from every record. checkProvenance says when any of it no longer holds.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveError, type Archive, type LicencePolicy, type MediaType, type Quality } from "@av/archive-media";
import {
  ATTRIBUTIONS_FILE, EVIDENCE_DIR, PROVENANCE_SUFFIX, renderAttributions, validateMediaProvenance, type MediaProvenance,
} from "@studio/contracts/src/media-provenance.mjs";

export const MEDIA_DIRS: Record<MediaType, string> = { image: "assets/images", video: "assets/video", audio: "assets/sounds" };
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export interface FetchIntoWorkspace {
  archive: Archive;
  provider: string;
  id: string;
  /** The asset id: the file's name without extension. */
  name: string;
  policy?: LicencePolicy;
  quality?: Quality;
  maxBytes?: number;
  /** Provider rendition id, as advertised by search. */
  rendition?: string;
  /** Replace a file of that name already fetched. */
  replace?: boolean;
}

/** Files in the medium's folder whose name, without extension, is `name`. */
function namesakes(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => !f.startsWith(".") && !f.endsWith(".json") && f.slice(0, f.lastIndexOf(".") > 0 ? f.lastIndexOf(".") : f.length).toLowerCase() === name.toLowerCase());
}

/**
 * Fetch one archive item into the workspace, with its record and evidence,
 * and write ATTRIBUTIONS.md again. Refuses a name already taken (unless
 * `replace`), a licence the policy does not allow, a file below the quality.
 */
export async function fetchIntoWorkspace(workspaceDir: string, options: FetchIntoWorkspace): Promise<{ record: MediaProvenance; path: string; recordPath: string }> {
  if (!NAME.test(options.name)) throw new ArchiveError("bad-response", `"${options.name}" is not an asset id (letters, digits, _ and -; at most 64)`);
  const item = await options.archive.item(options.provider, options.id);
  const selectedRendition = options.rendition ? item.renditions?.find((rendition) => rendition.id === options.rendition) : undefined;
  const folder = MEDIA_DIRS[selectedRendition?.mediaType ?? item.mediaType];
  const dir = join(workspaceDir, folder);
  const taken = namesakes(dir, options.name);
  if (taken.length > 0 && !options.replace) {
    throw new ArchiveError("bad-response", `${folder} already has ${taken.join(", ")}: choose another name, or replace it`);
  }
  // Only what the archive brought may be replaced: a file without its record is someone's own.
  const previous = existsSync(join(dir, `${options.name}${PROVENANCE_SUFFIX}`))
    ? (JSON.parse(readFileSync(join(dir, `${options.name}${PROVENANCE_SUFFIX}`), "utf-8")) as { file?: { path?: string } })
    : null;
  const own = taken.filter((f) => previous?.file?.path !== `${folder}/${f}`);
  if (own.length > 0) {
    throw new ArchiveError("bad-response", `${folder}/${own.join(", ")} is not from the archive (no record names it): it is never replaced; choose another name`);
  }
  // Fetched aside, then put in place: a refusal leaves the workspace as it was.
  const staging = join(dir, `.fetch-${options.name}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    const got = await options.archive.fetch(options.provider, options.id, {
      dir: staging, name: options.name,
      ...(options.policy ? { policy: options.policy } : {}), ...(options.quality ? { quality: options.quality } : {}), ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
      ...(options.rendition ? { rendition: options.rendition } : {}),
      probe: async (file) => probeMedia(file),
    });
    const fileName = got.file.slice(staging.length + 1);
    const evidenceText = `${JSON.stringify(got.item.raw, null, 2)}\n`;
    const evidenceHash = sha256(evidenceText);
    const evidencePath = `${EVIDENCE_DIR}/${evidenceHash.slice("sha256:".length)}.json`;
    const record: MediaProvenance = {
      apiVersion: "studio.video/v1alpha1",
      kind: "MediaProvenance",
      file: {
        path: `${folder}/${fileName}`, hash: got.sha256, bytes: got.bytes, mime: got.mime,
        ...(got.width ? { width: got.width } : {}), ...(got.height ? { height: got.height } : {}),
        ...(got.durationSeconds ? { durationSeconds: got.durationSeconds } : {}),
      },
      provider: { id: got.item.provider, label: options.archive.providers().find((p) => p.id === got.item.provider)?.label ?? got.item.provider },
      item: {
        id: got.item.id, title: got.item.title,
        ...(got.item.creator ? { creator: got.item.creator } : {}), ...(got.item.date ? { date: got.item.date } : {}),
        ...(got.item.institution ? { institution: got.item.institution } : {}),
        landingUrl: got.item.landingUrl, fileUrl: got.item.fileUrl, ...(got.item.rendition ? { rendition: got.item.rendition } : {}),
      },
      licence: {
        id: got.item.licence.id, ...(got.item.licence.basis ? { basis: got.item.licence.basis } : {}),
        ...(got.item.licence.url ? { url: got.item.licence.url } : {}),
        attributionRequired: got.item.licence.attributionRequired, statement: got.item.licence.statement,
      },
      attribution: got.item.attribution,
      retrievedAt: got.retrievedAt,
      evidence: { path: evidencePath, hash: evidenceHash },
    };
    const problems = validateMediaProvenance(record);
    if (problems.length > 0) throw new ArchiveError("bad-response", `the provider's record does not make a valid provenance: ${problems.map((p) => `${p.path} ${p.message}`).join("; ")}`);
    mkdirSync(join(workspaceDir, EVIDENCE_DIR), { recursive: true });
    writeFileSync(join(workspaceDir, evidencePath), evidenceText);
    // The new file and its record first; the old one goes only once they are in place.
    renameSync(got.file, join(dir, fileName));
    const recordPath = `${folder}/${options.name}${PROVENANCE_SUFFIX}`;
    writeFileSync(join(workspaceDir, `${recordPath}.tmp`), `${JSON.stringify(record, null, 2)}\n`);
    renameSync(join(workspaceDir, `${recordPath}.tmp`), join(workspaceDir, recordPath));
    for (const old of taken) if (old !== fileName) rmSync(join(dir, old), { force: true });
    writeAttributions(workspaceDir);
    return { record, path: record.file.path, recordPath };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** A video's or a sound's size and length, by ffprobe; null when it cannot say. */
export function probeMedia(file: string): { width?: number; height?: number; durationSeconds?: number } | null {
  const run = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], { encoding: "utf-8", timeout: 30_000 });
  if (run.status !== 0 || !run.stdout) return null;
  try {
    const info = JSON.parse(run.stdout) as { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { duration?: string } };
    const video = info.streams?.find((s) => s.codec_type === "video" && s.width && s.height);
    const duration = Number(info.format?.duration);
    return {
      ...(video ? { width: video.width!, height: video.height! } : {}),
      ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}),
    };
  } catch {
    return null;
  }
}

/** Every provenance record of the workspace, by its path; unreadable ones as problems. */
export function readProvenance(workspaceDir: string): { records: { path: string; record: MediaProvenance }[]; problems: { path: string; message: string }[] } {
  const records: { path: string; record: MediaProvenance }[] = [];
  const problems: { path: string; message: string }[] = [];
  for (const folder of Object.values(MEDIA_DIRS)) {
    const dir = join(workspaceDir, folder);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(PROVENANCE_SUFFIX)).sort()) {
      const path = `${folder}/${name}`;
      try {
        const doc = JSON.parse(readFileSync(join(dir, name), "utf-8"));
        const shape = validateMediaProvenance(doc);
        if (shape.length > 0) problems.push({ path, message: shape.map((p) => `${p.path} ${p.message}`).join("; ") });
        else records.push({ path, record: doc });
      } catch (error) {
        problems.push({ path, message: `not JSON: ${(error as Error).message}` });
      }
    }
  }
  return { records, problems };
}

/** ATTRIBUTIONS.md again, from every valid record. Returns its path, relative to the workspace. */
export function writeAttributions(workspaceDir: string): string {
  const { records } = readProvenance(workspaceDir);
  writeFileSync(join(workspaceDir, ATTRIBUTIONS_FILE), renderAttributions(records.map((r) => r.record)));
  return ATTRIBUTIONS_FILE;
}

/**
 * Does every archive file still hold: its record valid, its bytes the ones
 * fetched, its evidence there and unchanged, ATTRIBUTIONS.md current?
 */
export function checkProvenance(workspaceDir: string): { ok: boolean; files: number; problems: { path: string; message: string }[] } {
  const { records, problems } = readProvenance(workspaceDir);
  for (const { path, record } of records) {
    const file = join(workspaceDir, record.file.path);
    if (!existsSync(file)) problems.push({ path: record.file.path, message: `named by ${path}, but missing` });
    else if (sha256(readFileSync(file)) !== record.file.hash) problems.push({ path: record.file.path, message: `not the file fetched (${path} names another hash)` });
    const evidence = join(workspaceDir, record.evidence.path);
    if (!existsSync(evidence)) problems.push({ path: record.evidence.path, message: `the evidence ${path} names is missing` });
    else if (sha256(readFileSync(evidence)) !== record.evidence.hash) problems.push({ path: record.evidence.path, message: "the evidence changed since it was fetched" });
  }
  const attributions = join(workspaceDir, ATTRIBUTIONS_FILE);
  const expected = renderAttributions(records.map((r) => r.record));
  if (records.length > 0 && (!existsSync(attributions) || readFileSync(attributions, "utf-8") !== expected)) {
    problems.push({ path: ATTRIBUTIONS_FILE, message: "not current: make it again from the records" });
  }
  return { ok: problems.length === 0, files: records.length, problems };
}
