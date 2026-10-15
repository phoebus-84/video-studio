// Publish new media without clobbering assets, sidecars or evidence. Rendering
// happens in a private directory on the destination filesystem. Failed jobs
// leave no final asset, so the same name can be retried.
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVIDENCE_DIR, PROVENANCE_SUFFIX, validateMediaProvenance, type MediaProvenance } from "@studio/contracts/src/media-provenance.mjs";
import { writeAttributions } from "./archive-media.js";
import { assertMediaAllowed, assertMediaQuality, mediaHash, mediaPath, verifyMediaEvidence, type MediaRules } from "./media-integrity.js";

export function newMediaName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error("invalid asset name");
}
export async function publishMedia(workspace: string, folder: string, name: string, ext: string, rules: MediaRules,
  build: (file: string, scratch: string) => Promise<{ record: MediaProvenance; evidenceText: string }>) {
  newMediaName(name);
  const dir = mediaPath(workspace, folder);
  mkdirSync(dir, { recursive: true });
  const path = `${folder}/${name}${ext}`, recordPath = `${folder}/${name}${PROVENANCE_SUFFIX}`;
  // Refuse another extension of the same asset id too, on case-sensitive hosts.
  if (readdirSync(dir).some((f) => f.toLowerCase() === `${name}${PROVENANCE_SUFFIX}`.toLowerCase() || f.slice(0, f.lastIndexOf(".")).toLowerCase() === name.toLowerCase())) throw new Error(`${name} already exists`);
  const target = mediaPath(workspace, path), sidecar = mediaPath(workspace, recordPath);
  const scratch = mkdtempSync(join(dir, `.produce-${name}-`));
  const file = join(scratch, `media${ext}`);
  let published = false, recorded = false;
  try {
    const { record, evidenceText } = await build(file, scratch);
    const problems = validateMediaProvenance(record);
    if (problems.length) throw new Error(`invalid produced provenance: ${problems[0]!.message}`);
    if (record.file.path !== path || mediaHash(readFileSync(file)) !== record.file.hash) throw new Error("produced media does not match provenance");
    assertMediaAllowed(record.licence, rules); assertMediaQuality(record, rules);
    verifyMediaEvidence(record, evidenceText);
    const evidence = mediaPath(workspace, record.evidence.path);
    mkdirSync(dirname(evidence), { recursive: true });
    if (existsSync(evidence)) {
      if (mediaHash(readFileSync(evidence)) !== record.evidence.hash) throw new Error("existing evidence hash mismatch");
    } else {
      const stagedEvidence = join(scratch, "evidence.json"); writeFileSync(stagedEvidence, evidenceText);
      try { linkSync(stagedEvidence, evidence); }
      catch (error) { if (!existsSync(evidence) || mediaHash(readFileSync(evidence)) !== record.evidence.hash) throw error; }
    }
    const stagedRecord = join(scratch, "record.json"); writeFileSync(stagedRecord, `${JSON.stringify(record, null, 2)}\n`);
    // link is atomic and refuses an existing destination, unlike rename on Unix.
    linkSync(file, target); published = true;
    linkSync(stagedRecord, sidecar); recorded = true;
    writeAttributions(workspace);
    return { path, recordPath, record };
  } catch (error) {
    if (recorded) rmSync(sidecar, { force: true });
    if (published) rmSync(target, { force: true });
    throw error;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export function producedRecord(file: string, path: string, source: Omit<MediaProvenance, "file" | "evidence" | "retrievedAt">,
  evidenceText: string, facts: Omit<MediaProvenance["file"], "path" | "hash" | "bytes">): MediaProvenance {
  const bytes = readFileSync(file), hash = mediaHash(evidenceText);
  return { ...source, file: { path, hash: mediaHash(bytes), bytes: bytes.length, ...facts }, retrievedAt: new Date().toISOString(), evidence: { path: `${EVIDENCE_DIR}/${hash.slice(7)}.json`, hash } };
}
