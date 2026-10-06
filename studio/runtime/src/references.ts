// ---------------------------------------------------------------------------
// The operator's side of golden references (avg-jao.6, ADR-0037)
// ---------------------------------------------------------------------------
// What `vpr reference approve | withdraw | verify | list` do. Approving and
// withdrawing sign with the operator key, so they belong to the operator's
// CLI, never to Pi. The record of a reference is its signed descriptor (and,
// once withdrawn, its signed withdrawal) — append-only files in the series,
// not journal review events: those are written only by ExecutionService.review
// (avg-qr4.3), and a reference is not a pipeline stage.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { episodePath, seriesPath, seriesReferencePath, seriesReferenceWithdrawalPath } from "@studio/contracts/src/layout.mjs";
import type { GateReview } from "@studio/contracts/src/gate-review.mjs";
import { signReceipt } from "@studio/contracts/src/receipt.mjs";
import {
  buildReferenceApproval,
  buildReferenceWithdrawal,
  REFERENCE_SNAPSHOT_DIR,
  verifySeriesReference,
  type ReferenceProblem,
  type ReferenceVerdict,
} from "@studio/contracts/src/series-references.mjs";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export type ReferenceOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; problems?: ReferenceProblem[] };
const refuse = <T>(code: string, message: string, problems?: ReferenceProblem[]): ReferenceOutcome<T> =>
  ({ ok: false, code, message, ...(problems ? { problems } : {}) });

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

/**
 * Sign and promote an episode's proposed reference. Verifies everything the
 * descriptor will claim before writing it; writes it with an exclusive
 * create, so a promoted reference is never rewritten.
 */
export function approveReference(input: {
  libraryRoot: string;
  ref: EpisodeRef;
  referenceId: string;
  key: string | null;
  note?: string;
  dryRun?: boolean;
  at?: string;
}): ReferenceOutcome<{ path: string; descriptor: Record<string, unknown>; verdict: ReferenceVerdict; written: boolean }> {
  const { libraryRoot, ref, referenceId, key } = input;
  const episodeDir = episodePath(libraryRoot, ref.channel, ref.series, ref.episode);
  const proposalPath = join(episodeDir, REFERENCE_SNAPSHOT_DIR, referenceId, "proposal.json");
  if (!existsSync(proposalPath)) {
    return refuse("no-proposal", `${REFERENCE_SNAPSHOT_DIR}/${referenceId}/proposal.json does not exist: propose the reference first`);
  }
  let proposal: Record<string, any>;
  try {
    proposal = JSON.parse(readFileSync(proposalPath, "utf-8"));
  } catch (error) {
    return refuse("bad-proposal", `the proposal is not JSON: ${(error as Error).message}`);
  }

  // What is approved is exactly what was proposed.
  const changed = ["spec", "timeline", "render", "report"].filter((field) => {
    const file = join(episodeDir, String(proposal[field]?.path));
    return !existsSync(file) || `sha256:${sha256(readFileSync(file))}` !== proposal[field]?.hash;
  });
  if (changed.length > 0) {
    return refuse("proposal-changed", `${changed.map((f) => proposal[f]?.path).join(", ")} changed or disappeared since the proposal: propose again`);
  }

  const templateId = String(proposal.template?.id);
  let target: string;
  try {
    target = seriesReferencePath(libraryRoot, ref.channel, ref.series, templateId, referenceId);
  } catch (error) {
    return refuse("bad-proposal", (error as Error).message);
  }
  if (existsSync(target)) return refuse("reference-exists", `${referenceId} is already a reference of this series: a promoted reference is never rewritten`);
  if (!key) return refuse("no-operator-key", "only the operator can approve a reference, and no operator key was found");

  const approval = signReceipt(buildReferenceApproval({
    reference: proposal as never,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.at !== undefined ? { at: input.at } : {}),
  }), key);
  const descriptor = { ...proposal, approval };
  const text = `${JSON.stringify(descriptor, null, 2)}\n`;
  const verdict = verifySeriesReference({
    seriesDir: seriesPath(libraryRoot, ref.channel, ref.series),
    templateId,
    referenceId,
    key,
    descriptor: text,
  });
  if (verdict.state !== "trusted") {
    return refuse("not-trusted", `the reference would not verify (${verdict.state}): nothing was written`, verdict.problems);
  }
  if (input.dryRun) return { ok: true, value: { path: target, descriptor, verdict, written: false } };

  mkdirSync(join(target, ".."), { recursive: true });
  try {
    writeFileSync(target, text, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return refuse("reference-exists", `${referenceId} was just promoted by someone else`);
    throw error;
  }
  return { ok: true, value: { path: target, descriptor, verdict, written: true } };
}

/** Withdraw a promoted reference: a signed, append-only record; the evidence stays. */
export function withdrawReference(input: {
  libraryRoot: string;
  channel: string;
  series: string;
  templateId: string;
  referenceId: string;
  key: string | null;
  reason: string;
  at?: string;
}): ReferenceOutcome<{ path: string; withdrawal: GateReview }> {
  const { libraryRoot, channel, series, templateId, referenceId, key, reason } = input;
  if (!reason || !reason.trim()) return refuse("no-reason", "a withdrawal needs --reason: one nobody can act on is noise");
  let descriptorPath: string;
  try {
    descriptorPath = seriesReferencePath(libraryRoot, channel, series, templateId, referenceId);
  } catch (error) {
    return refuse("bad-id", (error as Error).message);
  }
  if (!existsSync(descriptorPath)) return refuse("missing-reference", `${templateId}/${referenceId} is not a reference of ${channel}/${series}`);
  const target = seriesReferenceWithdrawalPath(libraryRoot, channel, series, templateId, referenceId);
  if (existsSync(target)) return refuse("already-withdrawn", `${referenceId} is already withdrawn; a withdrawal is never undone or repeated`);
  if (!key) return refuse("no-operator-key", "only the operator can withdraw a reference, and no operator key was found");

  const bytes = readFileSync(descriptorPath);
  let reference: Record<string, any>;
  try {
    reference = JSON.parse(bytes.toString("utf-8"));
  } catch (error) {
    return refuse("bad-reference", `the descriptor is not JSON: ${(error as Error).message}`);
  }
  const withdrawal = signReceipt(buildReferenceWithdrawal({
    reference: reference as never,
    descriptorHash: sha256(bytes),
    reason,
    ...(input.at !== undefined ? { at: input.at } : {}),
  }), key);
  try {
    writeFileSync(target, `${JSON.stringify(withdrawal, null, 2)}\n`, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return refuse("already-withdrawn", `${referenceId} was just withdrawn by someone else`);
    throw error;
  }
  return { ok: true, value: { path: target, withdrawal } };
}

/** Every reference of a series, with its verdict. */
export function listReferences(input: { libraryRoot: string; channel: string; series: string; key: string | null }): {
  templateId: string;
  referenceId: string;
  verdict: ReferenceVerdict;
}[] {
  const seriesDir = seriesPath(input.libraryRoot, input.channel, input.series);
  const templates = join(seriesDir, "templates");
  if (!existsSync(templates)) return [];
  const out = [];
  for (const templateId of readdirSync(templates).sort()) {
    const refs = join(templates, templateId, "references");
    if (!existsSync(refs)) continue;
    for (const file of readdirSync(refs).sort()) {
      if (!file.endsWith(".json") || file.endsWith(".withdrawal.json")) continue;
      const referenceId = file.slice(0, -".json".length);
      out.push({ templateId, referenceId, verdict: verifySeriesReference({ seriesDir, templateId, referenceId, key: input.key }) });
    }
  }
  return out;
}
