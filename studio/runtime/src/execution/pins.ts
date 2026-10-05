// ---------------------------------------------------------------------------
// Source pins in the runtime (avg-7zp.5, ADR-0035)
// ---------------------------------------------------------------------------
// An episode pins shared material — a channel source or another episode —
// in source/pins/<id>.json. Status re-checks every pin cheaply (stat first,
// hash only what moved) and reports the stages that read a changed source,
// and everything downstream of them, as stale. Status writes nothing.
//
// Accepting the new version is renewal: the inventory is rewritten and a
// `staleness-marked` event (trigger "pin:<id>") keeps those stages stale
// until they run again — the mechanism the runtime already has. Renewal hides
// nothing, so any actor may do it; the journal records who.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PINS_DIR,
  describeChanges,
  inventory,
  sourceDir,
  validateSourcePin,
  verifyPin,
} from "@studio/contracts/src/source-pins.mjs";
import type { PinChange, SourcePin, SourceRef } from "@studio/contracts/src/source-pins.mjs";
import { appendJournalEvent } from "@studio/contracts/src/journal.mjs";
import { propagate } from "../staleness/index.js";
import type { ResolvedPipeline } from "../pipeline/types.js";
import type { EpisodeRef } from "./types.js";

export type PinActor = "human" | "pi";

/** What `addPin` and `renewPin` refuse, by name. */
export type PinRefusal =
  | { code: "unknown-source"; message: string }
  | { code: "unknown-stage"; message: string }
  | { code: "self-pin"; message: string }
  | { code: "pin-exists"; message: string }
  | { code: "unknown-pin"; message: string }
  | { code: "invalid-pin"; message: string }
  | { code: "journal-unwritable"; message: string };

/** A pin id is a plain name: it becomes a file name under source/pins/, so nothing else may reach the filesystem. */
const PIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const slugOf = (ref: EpisodeRef) => `${ref.channel}/${ref.series}/${ref.episode}`;

export function sourceLabel(source: SourceRef): string {
  return source.kind === "channel-source" ? `source "${source.name}"` : `episode "${source.series}/${source.episode}"`;
}

/** The stages a set of readers makes stale: the readers themselves and everything downstream. */
function affectedBy(pipeline: ResolvedPipeline, usedBy: string[], ref: EpisodeRef): string[] {
  const known = new Set(pipeline.stages.map((s) => s.definition.id));
  const readers = usedBy.filter((id) => known.has(id));
  if (readers.length === 0) return [];
  const report = propagate(pipeline, readers, slugOf(ref));
  const stale = new Set([...readers, ...report.stages.filter((s) => s.stale).map((s) => s.stageId)]);
  return pipeline.stages.map((s) => s.definition.id).filter((id) => stale.has(id));
}

async function writeAtomically(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, file);
}

async function readPinFiles(episodeDir: string): Promise<{ file: string; raw: unknown; error?: string }[]> {
  const dir = join(episodeDir, PINS_DIR);
  if (!existsSync(dir)) return [];
  const out: { file: string; raw: unknown; error?: string }[] = [];
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
    try {
      out.push({ file: name, raw: JSON.parse(await readFile(join(dir, name), "utf-8")) });
    } catch (e) {
      out.push({ file: name, raw: null, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/**
 * Stage id → why a pin makes it stale. Read-only: nothing is written.
 * A pin that cannot be read or checked makes its readers stale too — never
 * silently ignored; when its readers are unknown, every stage is affected.
 */
export async function pinStaleness(
  libraryRoot: string, ref: EpisodeRef, episodeDir: string, pipeline: ResolvedPipeline,
): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  const allStages = pipeline.stages.map((s) => s.definition.id);
  const mark = (pinName: string, usedBy: string[], reason: string) => {
    let affected = affectedBy(pipeline, usedBy, ref);
    if (affected.length === 0) {
      // Readers the pipeline no longer has must not hide a problem: report it everywhere.
      affected = allStages;
      reason = `pin "${pinName}" names no stage of this pipeline (${usedBy.join(", ")}); ${reason}`;
    }
    for (const id of affected) if (!reasons.has(id)) reasons.set(id, reason);
  };
  for (const { file, raw, error } of await readPinFiles(episodeDir)) {
    const readers = Array.isArray((raw as { usedBy?: unknown })?.usedBy)
      ? ((raw as { usedBy: unknown[] }).usedBy.filter((x) => typeof x === "string") as string[])
      : allStages;
    if (error) {
      mark(file, readers, `pin "${file}" cannot be read: ${error}`);
      continue;
    }
    const problems = validateSourcePin(raw);
    if (problems.length > 0) {
      mark(file, readers, `pin "${file}" is not valid: ${problems[0]!.path} ${problems[0]!.message}`);
      continue;
    }
    const pin = raw as SourcePin;
    const dir = sourceDir(libraryRoot, ref.channel, pin.source);
    if (!existsSync(dir)) {
      mark(pin.id, pin.usedBy, `${sourceLabel(pin.source)} pinned as "${pin.id}" no longer exists`);
      continue;
    }
    let changed;
    try {
      ({ changed } = await verifyPin(pin, dir));
    } catch (e) {
      // One unreadable source must not take the whole status down: it is this pin's problem.
      mark(pin.id, pin.usedBy, `pin "${pin.id}" cannot be checked: ${message(e)}`);
      continue;
    }
    if (changed.length > 0) {
      mark(pin.id, pin.usedBy, `${sourceLabel(pin.source)} changed since it was pinned: ${describeChanges(changed)} — renew the pin to accept the new version`);
    }
  }
  return reasons;
}

/** Every pin of the episode and what changed in its source. Read-only. */
export async function verifyPins(
  libraryRoot: string, ref: EpisodeRef, episodeDir: string,
): Promise<{ id: string; source?: SourceRef; changed: PinChange[]; problem?: string }[]> {
  const out = [];
  for (const { file, raw, error } of await readPinFiles(episodeDir)) {
    const id = file.replace(/\.json$/, "");
    const problems = error ? [] : validateSourcePin(raw);
    if (error || problems.length > 0) {
      out.push({ id, changed: [], problem: error ?? `${problems[0]!.path} ${problems[0]!.message}` });
      continue;
    }
    const pin = raw as SourcePin;
    const dir = sourceDir(libraryRoot, ref.channel, pin.source);
    if (!existsSync(dir)) {
      out.push({ id, source: pin.source, changed: [], problem: `${sourceLabel(pin.source)} no longer exists` });
      continue;
    }
    out.push({ id, source: pin.source, changed: (await verifyPin(pin, dir)).changed });
  }
  return out;
}

/** Inventory a source and write a new pin. */
export async function addPin(
  libraryRoot: string, ref: EpisodeRef, episodeDir: string, pipeline: ResolvedPipeline,
  input: { id: string; source: SourceRef; usedBy: string[]; paths?: string[]; now: Date },
): Promise<{ ok: true; pin: SourcePin } | { ok: false; refusal: PinRefusal }> {
  if (!PIN_ID.test(input.id)) {
    return { ok: false, refusal: { code: "invalid-pin", message: `pin id "${input.id}" is not a plain name` } };
  }
  if (input.source.kind === "episode" && input.source.series === ref.series && input.source.episode === ref.episode) {
    return { ok: false, refusal: { code: "self-pin", message: `an episode cannot pin itself` } };
  }
  const known = new Set(pipeline.stages.map((s) => s.definition.id));
  const unknown = input.usedBy.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return { ok: false, refusal: { code: "unknown-stage", message: `not stages of this pipeline: ${unknown.join(", ")}` } };
  }
  const dir = sourceDir(libraryRoot, ref.channel, input.source);
  if (!existsSync(dir)) {
    return { ok: false, refusal: { code: "unknown-source", message: `${sourceLabel(input.source)} does not exist at ${dir}` } };
  }
  const file = join(episodeDir, PINS_DIR, `${input.id}.json`);
  if (existsSync(file)) {
    return { ok: false, refusal: { code: "pin-exists", message: `pin "${input.id}" already exists: renew it instead` } };
  }
  let files;
  try {
    files = await inventory(dir, input.paths);
  } catch (e) {
    return { ok: false, refusal: { code: "invalid-pin", message: `${sourceLabel(input.source)} cannot be inventoried: ${message(e)}` } };
  }
  const pin = {
    apiVersion: "studio.video/v1alpha1", kind: "SourcePin", id: input.id, source: input.source,
    ...(input.paths && input.paths.length > 0 ? { paths: input.paths } : {}),
    usedBy: input.usedBy, pinnedAt: input.now.toISOString(), files,
  } as SourcePin;
  const problems = validateSourcePin(pin);
  if (problems.length > 0) {
    return { ok: false, refusal: { code: "invalid-pin", message: `${problems[0]!.path} ${problems[0]!.message}` } };
  }
  await mkdir(join(episodeDir, PINS_DIR), { recursive: true });
  await writeAtomically(file, `${JSON.stringify(pin, null, 2)}\n`);
  return { ok: true, pin };
}

/** Accept a source's current version: rewrite the inventory and record which stages must be redone. */
export async function renewPin(
  libraryRoot: string, ref: EpisodeRef, episodeDir: string, pipeline: ResolvedPipeline,
  input: { id: string; actor: PinActor; now: Date },
): Promise<{ ok: true; changed: PinChange[]; affected: string[] } | { ok: false; refusal: PinRefusal }> {
  if (!PIN_ID.test(input.id)) {
    return { ok: false, refusal: { code: "invalid-pin", message: `pin id "${input.id}" is not a plain name` } };
  }
  const file = join(episodeDir, PINS_DIR, `${input.id}.json`);
  if (!existsSync(file)) return { ok: false, refusal: { code: "unknown-pin", message: `no pin "${input.id}"` } };
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf-8"));
  } catch (e) {
    return { ok: false, refusal: { code: "invalid-pin", message: e instanceof Error ? e.message : String(e) } };
  }
  const problems = validateSourcePin(raw);
  if (problems.length > 0) {
    return { ok: false, refusal: { code: "invalid-pin", message: `${problems[0]!.path} ${problems[0]!.message}` } };
  }
  const pin = raw as SourcePin;
  const dir = sourceDir(libraryRoot, ref.channel, pin.source);
  if (!existsSync(dir)) {
    return { ok: false, refusal: { code: "unknown-source", message: `${sourceLabel(pin.source)} does not exist at ${dir}` } };
  }
  let changed;
  let files;
  try {
    ({ changed } = await verifyPin(pin, dir));
    files = await inventory(dir, pin.paths);
  } catch (e) {
    return { ok: false, refusal: { code: "invalid-pin", message: `${sourceLabel(pin.source)} cannot be inventoried: ${message(e)}` } };
  }
  const affected = changed.length > 0 ? affectedBy(pipeline, pin.usedBy, ref) : [];
  if (affected.length > 0) {
    // Journal first: if the record cannot land, the pin keeps its old inventory and the
    // change stays visible. The reverse order could accept a change nobody is told to redo.
    const trigger = `pin:${pin.id}`;
    const written = await appendJournalEvent(episodeDir, {
      type: "staleness-marked", actor: input.actor, episode: ref,
      data: { stageId: trigger, trigger, affected: affected.map((stageId) => ({ stageId, path: [trigger, stageId] })), changed },
    });
    if (!written) {
      return { ok: false, refusal: { code: "journal-unwritable", message: `the journal cannot be written: pin "${pin.id}" was not renewed` } };
    }
  }
  await writeAtomically(file, `${JSON.stringify({ ...pin, pinnedAt: input.now.toISOString(), files }, null, 2)}\n`);
  return { ok: true, changed, affected };
}
