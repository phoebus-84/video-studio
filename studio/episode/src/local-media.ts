// Preventive lookup and immutable reuse of already-fetched licensed media.
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { PROVENANCE_SUFFIX } from "@studio/contracts/src/media-provenance.mjs";
import type { MediaProvenance } from "@studio/contracts/src/media-provenance.mjs";
import { readProvenance } from "./archive-media.js";
import { assertMediaAllowed, assertMediaQuality, mediaHash, mediaPath, verifiedMedia, type MediaRules } from "./media-integrity.js";
import { newMediaName, publishMedia } from "./media-output.js";

export interface LocalMediaHit { workspace: string; recordPath: string; record: MediaProvenance }
/** Search canonical records, never following symlinks or advertising broken provenance. */
export function findLocalMedia(channelDir: string, query = "", limit = 50): LocalMediaHit[] {
  const root = realpathSync(channelDir), wanted = query.toLowerCase().split(/\s+/).filter(Boolean), out: LocalMediaHit[] = [];
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 7 || out.length >= limit || seen++ > 20_000) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= limit) break;
      const path = join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) { if (!ent.name.startsWith(".") && !["node_modules", "output", "attempts"].includes(ent.name)) walk(path, depth + 1); continue; }
      if (!ent.name.endsWith(PROVENANCE_SUFFIX) || !/[/\\]assets[/\\](images|video|sounds|animations|fonts)[/\\]/.test(path)) continue;
      try {
        const workspace = dirname(dirname(dirname(path)));
        const { record } = verifiedMedia(workspace, relative(workspace, path).replaceAll("\\", "/"));
        const hay = `${record.item.title} ${record.item.creator ?? ""} ${record.attribution} ${record.provider.id}`.toLowerCase();
        if (wanted.every((word) => hay.includes(word))) out.push({ workspace: relative(root, workspace).replaceAll("\\", "/"), recordPath: relative(root, path).replaceAll("\\", "/"), record });
      } catch { /* broken records belong in provenance checks, not reuse results */ }
    }
  };
  walk(root, 0);
  return out;
}
/** Reapply the destination's policy and copy the self-contained verified chain. */
export async function reuseLocalMedia(channelDir: string, sourceRecordPath: string, targetWorkspace: string, name: string, rules: MediaRules = {}): Promise<{ path: string; recordPath: string; deduplicated: boolean }> {
  newMediaName(name);
  const root = realpathSync(channelDir), sourceRecord = mediaPath(root, sourceRecordPath), target = mediaPath(root, targetWorkspace);
  if (!/[/\\]assets[/\\](images|video|sounds|animations|fonts)[/\\][^/\\]+\.source\.json$/.test(sourceRecord)) throw new Error("source must be a canonical media record");
  const sourceWorkspace = dirname(dirname(dirname(sourceRecord)));
  const parent = verifiedMedia(sourceWorkspace, relative(sourceWorkspace, sourceRecord).replaceAll("\\", "/"));
  const record = parent.record;
  assertMediaAllowed(record.licence, rules); assertMediaQuality(record, rules);
  // Matching bytes alone do not imply matching rights/evidence. Verify the
  // existing destination too before reporting a successful deduplication.
  for (const found of readProvenance(target).records) {
    if (found.record.file.hash !== record.file.hash || found.record.evidence.hash !== record.evidence.hash || JSON.stringify(found.record.licence) !== JSON.stringify(record.licence)) continue;
    verifiedMedia(target, found.path);
    return { path: found.record.file.path, recordPath: found.path, deduplicated: true };
  }
  const folder = record.file.path.split("/").slice(0, 2).join("/");
  const ext = record.file.path.slice(record.file.path.lastIndexOf("."));
  const got = await publishMedia(target, folder, name, ext, rules, async (file) => {
    const bytes = readFileSync(mediaPath(sourceWorkspace, record.file.path));
    if (mediaHash(bytes) !== record.file.hash) throw new Error("source asset changed before copying");
    writeFileSync(file, bytes);
    return { record: { ...record, file: { ...record.file, path: `${folder}/${name}${ext}` } }, evidenceText: parent.evidenceText };
  });
  return { path: got.path, recordPath: got.recordPath, deduplicated: false };
}
