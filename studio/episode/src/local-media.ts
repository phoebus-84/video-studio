// Preventive lookup and immutable reuse of already-fetched licensed media.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PROVENANCE_SUFFIX, validateMediaProvenance, type MediaProvenance } from "@studio/contracts/src/media-provenance.mjs";
import { readProvenance, writeAttributions } from "./archive-media.js";

export interface LocalMediaHit { workspace: string; recordPath: string; record: MediaProvenance; }
const hash = (b: Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
function inside(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || resolve(rel) === rel) throw new Error("media path escapes its channel library");
}
/** Search every canonical provenance record under one channel, bounded to avoid accidental giant walks. */
export function findLocalMedia(channelDir: string, query = "", limit = 50): LocalMediaHit[] {
  const root = realpathSync(channelDir), wanted = query.toLowerCase().split(/\s+/).filter(Boolean), out: LocalMediaHit[] = [];
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 7 || out.length >= limit || seen++ > 20_000) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= limit) break;
      const path = join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) { if (!ent.name.startsWith(".") && ent.name !== "node_modules" && ent.name !== "output") walk(path, depth + 1); continue; }
      if (!ent.name.endsWith(PROVENANCE_SUFFIX)) continue;
      try {
        const record = JSON.parse(readFileSync(path, "utf-8")) as MediaProvenance;
        if (validateMediaProvenance(record).length) continue;
        const hay = `${record.item.title} ${record.item.creator ?? ""} ${record.attribution} ${record.provider.id}`.toLowerCase();
        if (wanted.every((word) => hay.includes(word))) out.push({ workspace: relative(root, dirname(dirname(dirname(path)))).replaceAll("\\", "/"), recordPath: relative(root, path).replaceAll("\\", "/"), record });
      } catch { /* malformed records are reported by provenance checks, not search */ }
    }
  };
  walk(root, 0);
  return out;
}
/** Reuse bytes and their evidence; no provider call, licence claim or transformation is repeated. */
export function reuseLocalMedia(channelDir: string, sourceRecordPath: string, targetWorkspace: string, name: string): { path: string; recordPath: string; deduplicated: boolean } {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error("invalid asset name");
  const root = realpathSync(channelDir), sourceRecord = resolve(root, sourceRecordPath), target = realpathSync(targetWorkspace);
  inside(root, sourceRecord); inside(root, target);
  const record = JSON.parse(readFileSync(sourceRecord, "utf-8")) as MediaProvenance;
  const problems = validateMediaProvenance(record); if (problems.length) throw new Error(`invalid source record: ${problems[0]!.message}`);
  const sourceWorkspace = resolve(dirname(sourceRecord), "..", "..");
  const sourceAsset = resolve(sourceWorkspace, record.file.path); inside(root, sourceAsset);
  const bytes = readFileSync(sourceAsset); if (hash(bytes) !== record.file.hash) throw new Error("source asset no longer matches its provenance hash");
  const found = readProvenance(target).records.find((x) => x.record.file.hash === record.file.hash);
  if (found) return { path: found.record.file.path, recordPath: found.path, deduplicated: true };
  const folder = record.file.path.split("/").slice(0, 2).join("/");
  const ext = record.file.path.includes(".") ? record.file.path.slice(record.file.path.lastIndexOf(".")) : "";
  const assetRel = `${folder}/${name}${ext}`, recRel = `${folder}/${name}${PROVENANCE_SUFFIX}`;
  const asset = join(target, assetRel), rec = join(target, recRel);
  if (existsSync(asset) || existsSync(rec)) throw new Error(`${assetRel} already exists`);
  const evidenceSrc = resolve(sourceWorkspace, record.evidence.path); inside(root, evidenceSrc);
  const evidenceDst = join(target, record.evidence.path);
  mkdirSync(dirname(asset), { recursive: true }); mkdirSync(dirname(evidenceDst), { recursive: true });
  cpSync(sourceAsset, asset); if (!existsSync(evidenceDst)) cpSync(evidenceSrc, evidenceDst);
  const next: MediaProvenance = { ...record, file: { ...record.file, path: assetRel } };
  writeFileSync(rec, `${JSON.stringify(next, null, 2)}\n`); writeAttributions(target);
  return { path: assetRel, recordPath: recRel, deduplicated: false };
}
