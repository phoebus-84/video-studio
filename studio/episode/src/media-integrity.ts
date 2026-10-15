// Shared checks for fetched media, immutable derivatives and cross-episode reuse.
// Derivation evidence embeds verified parent records and their evidence bytes, so
// a copied derivative never depends on mutable paths in another episode.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DEFAULT_QUALITY, licenceAllowed, tooSmall, type LicencePolicy, type Quality } from "@av/archive-media";
import { PROVENANCE_SUFFIX, validateMediaProvenance, type MediaProvenance } from "@studio/contracts/src/media-provenance.mjs";

export interface MediaRules { policy?: LicencePolicy; quality?: Quality }
export interface MediaSource { record: MediaProvenance; recordHash: string; evidenceText: string }
export const mediaHash = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Resolve even a not-yet-created path against its nearest real ancestor. */
export function mediaPath(root: string, path: string): string {
  const base = realpathSync(root), target = resolve(base, path);
  let ancestor = target;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("media path has no existing ancestor");
    ancestor = parent;
  }
  const real = resolve(realpathSync(ancestor), relative(ancestor, target));
  const rel = relative(base, real);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("media path escapes its workspace");
  return real;
}

export function assertMediaAllowed(licence: MediaProvenance["licence"], rules: MediaRules = {}, adaptation = false): void {
  const allowed = licenceAllowed(licence, rules.policy);
  if (!allowed.ok) throw new Error(`licence-refused: ${allowed.reason}`);
  // Download permission is not permission to distribute an adaptation. Pure
  // transcoding is technical format shifting; trimming/cropping is not.
  if (adaptation && /^CC-BY(?:-NC)?-ND(?:-|$)/.test(licence.id)) throw new Error("licence-refused: ND media cannot be adapted for production");
}
export function assertMediaQuality(record: MediaProvenance, rules: MediaRules = {}): void {
  const mediaType = record.file.mime.startsWith("image/") ? "image" : record.file.mime.startsWith("video/") ? "video" : "audio";
  const small = tooSmall({ mediaType, width: record.file.width, height: record.file.height }, { ...DEFAULT_QUALITY, ...rules.quality });
  if (small) throw new Error(`too-small: ${small}`);
}

/** Verify the complete self-contained evidence chain, not just its outer hash. */
export function verifyMediaEvidence(record: MediaProvenance, evidenceText: string, depth = 0): void {
  if (depth > 32) throw new Error("provenance chain is too deep");
  if (mediaHash(evidenceText) !== record.evidence.hash) throw new Error("provenance evidence hash mismatch");
  const data = JSON.parse(evidenceText);
  if (["ffmpeg-derivative", "mapillary-still", "mapillary-hyperlapse", "mapillary-pan", "mapillary-planet"].includes(data?.kind)) throw new Error("legacy derivation has no verified portable chain: regenerate it from its sources");
  if (data?.kind !== "studio-media-derivation") return; // original provider response
  if (data.version !== 1 || !Array.isArray(data.sources) || !data.sources.length || !data.operation || typeof data.operation !== "object") throw new Error("invalid derivation evidence");
  for (const source of data.sources as MediaSource[]) {
    const problems = validateMediaProvenance(source?.record);
    if (problems.length || typeof source.evidenceText !== "string" || source.recordHash !== mediaHash(JSON.stringify(source.record))) throw new Error("invalid parent provenance snapshot");
    if (source.record.licence.id !== record.licence.id) throw new Error("derivation changed its parent's licence");
    verifyMediaEvidence(source.record, source.evidenceText, depth + 1);
  }
}

export function mediaSource(record: MediaProvenance, evidenceText: string): MediaSource {
  const problems = validateMediaProvenance(record);
  if (problems.length) throw new Error(`invalid source provenance: ${problems[0]!.message}`);
  verifyMediaEvidence(record, evidenceText);
  return { record, recordHash: mediaHash(JSON.stringify(record)), evidenceText };
}
export function derivationEvidence(operation: object, sources: MediaSource[]): string {
  return `${JSON.stringify({ kind: "studio-media-derivation", version: 1, operation, sources }, null, 2)}\n`;
}

/** Read the asset AND the evidence it names before deriving, copying or deduplicating. */
export function verifiedMedia(workspace: string, recordPath: string): MediaSource {
  const file = mediaPath(workspace, recordPath);
  const record = JSON.parse(readFileSync(file, "utf-8")) as MediaProvenance;
  const problems = validateMediaProvenance(record);
  if (problems.length) throw new Error(`invalid source provenance: ${problems[0]!.message}`);
  const expected = record.file.path.slice(0, record.file.path.lastIndexOf(".")) + PROVENANCE_SUFFIX;
  if (recordPath.replaceAll("\\", "/") !== expected) throw new Error("source record does not name its adjacent asset");
  const asset = mediaPath(workspace, record.file.path);
  if (!statSync(asset).isFile() || mediaHash(readFileSync(asset)) !== record.file.hash) throw new Error("source asset no longer matches its provenance hash");
  return mediaSource(record, readFileSync(mediaPath(workspace, record.evidence.path), "utf-8"));
}
