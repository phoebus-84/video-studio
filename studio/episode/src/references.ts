// ---------------------------------------------------------------------------
// Proposing an episode as one of its series' golden references (avg-jao.6)
// ---------------------------------------------------------------------------
// A proposal freezes what a person would approve: the episode's spec and
// timeline, copied into reviews/references/<id>/, and the render they made,
// referenced in place. Nothing here signs; only the operator's
// `vpr reference approve` turns a proposal into a reference (ADR-0037).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EPISODE_SPEC_PATH } from "@studio/contracts/src/layout.mjs";
import { REFERENCE_SNAPSHOT_DIR, type ReferenceProposal } from "@studio/contracts/src/series-references.mjs";
import { EDIT_TIMELINE_PATH } from "./edit-timeline-builder.js";
import { checkEpisode, isSpecDriven } from "./series-compile.js";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export interface ReferenceProblem {
  code: string;
  message: string;
  path: string;
}

export type ProposeResult =
  | {
    ok: true;
    proposal: ReferenceProposal;
    /** Files written, relative to the episode. */
    paths: string[];
  }
  | { ok: false; problems: ReferenceProblem[] };

const fail = (code: string, path: string, message: string): ProposeResult => ({ ok: false, problems: [{ code, path, message }] });

/** Freeze the episode's current render, spec and timeline as a proposed reference `referenceId`. */
export function proposeReference(
  episodeDir: string,
  options: { episodeRef: { channel: string; series: string; episode: string }; referenceId: string },
): ProposeResult {
  const { referenceId, episodeRef } = options;
  if (!SLUG.test(referenceId)) return fail("bad-id", "referenceId", `"${referenceId}" is not a lowercase kebab-case id`);
  if (!isSpecDriven(episodeDir)) return fail("no-spec", EPISODE_SPEC_PATH, "only an episode with a spec can be a series reference");

  const snapshotDir = `${REFERENCE_SNAPSHOT_DIR}/${referenceId}`;
  const spec = JSON.parse(readFileSync(join(episodeDir, EPISODE_SPEC_PATH), "utf-8"));
  const promoted = join(dirname(dirname(episodeDir)), "templates", String(spec?.template?.id), "references", `${referenceId}.json`);
  if (existsSync(join(episodeDir, snapshotDir)) || existsSync(promoted)) {
    return fail("reference-exists", snapshotDir, `the reference id "${referenceId}" is already proposed or promoted in this series: choose another`);
  }

  // The render to freeze, its report, and the timeline it was made from.
  const currentPath = join(episodeDir, "output", "current.json");
  let render: string;
  try {
    render = String(JSON.parse(readFileSync(currentPath, "utf-8")).path);
  } catch {
    return fail("no-render", "output/current.json", "the episode has no current render: render it first");
  }
  const renderPath = `output/${render}`;
  const reportPath = renderPath.replace(/\.mp4$/, ".report.json");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*\.mp4$/.test(render) || !existsSync(join(episodeDir, renderPath)) || !existsSync(join(episodeDir, reportPath))) {
    return fail("no-render", renderPath, `${renderPath} or its report is missing`);
  }
  let report: { timeline?: { hash?: unknown } } | null;
  try {
    report = JSON.parse(readFileSync(join(episodeDir, reportPath), "utf-8"));
  } catch {
    report = null;
  }
  const timelineFile = join(episodeDir, EDIT_TIMELINE_PATH);
  const timelineBytes = existsSync(timelineFile) ? readFileSync(timelineFile) : Buffer.alloc(0);
  if (report?.timeline?.hash !== sha256(timelineBytes)) {
    return fail("timeline-changed", EDIT_TIMELINE_PATH,
      `${EDIT_TIMELINE_PATH} is not the timeline ${render} was made from: render it again, or restore the timeline`);
  }

  // The spec frozen must be the one that timeline was compiled from.
  const timelineDoc = JSON.parse(timelineBytes.toString("utf-8"));
  if (timelineDoc?.derivedFrom?.spec?.hash !== sha256(readFileSync(join(episodeDir, EPISODE_SPEC_PATH)))) {
    return fail("spec-changed", EPISODE_SPEC_PATH,
      `${EPISODE_SPEC_PATH} changed after ${EDIT_TIMELINE_PATH} was compiled: render the episode again before proposing it`);
  }

  // A reference is the series' standard: it cannot break the series' rules.
  const checked = checkEpisode(episodeDir, { episodeRef, timeline: timelineDoc });
  if (!checked.ok) return { ok: false, problems: checked.problems };
  const errors = checked.findings.filter((f) => f.severity === "error");
  if (errors.length > 0) {
    return { ok: false, problems: errors.map((f) => ({ code: "series-rules", path: f.path, message: `${f.code}: ${f.message}` })) };
  }

  // Freeze. The directory is created exclusively: a concurrent proposal of the same id fails.
  mkdirSync(join(episodeDir, REFERENCE_SNAPSHOT_DIR), { recursive: true });
  try {
    mkdirSync(join(episodeDir, snapshotDir));
  } catch {
    return fail("reference-exists", snapshotDir, `the reference id "${referenceId}" was just proposed by someone else`);
  }
  copyFileSync(join(episodeDir, EPISODE_SPEC_PATH), join(episodeDir, snapshotDir, "episode-spec.json"));
  copyFileSync(join(episodeDir, EDIT_TIMELINE_PATH), join(episodeDir, snapshotDir, "edit-timeline.json"));
  const hashOf = (relative: string) => sha256(readFileSync(join(episodeDir, relative)));
  const proposal: ReferenceProposal = {
    apiVersion: "studio.video/v1alpha1",
    kind: "SeriesReference",
    id: referenceId,
    episodeRef: { channel: episodeRef.channel, series: episodeRef.series, episode: episodeRef.episode },
    template: { id: spec.template.id, version: spec.template.version, hash: spec.template.hash },
    spec: { path: `${snapshotDir}/episode-spec.json`, hash: hashOf(`${snapshotDir}/episode-spec.json`) },
    timeline: { path: `${snapshotDir}/edit-timeline.json`, hash: hashOf(`${snapshotDir}/edit-timeline.json`) },
    render: { path: renderPath, hash: hashOf(renderPath) },
    report: { path: reportPath, hash: hashOf(reportPath) },
    metadata: { proposedAt: new Date().toISOString() },
  };
  writeFileSync(join(episodeDir, snapshotDir, "proposal.json"), `${JSON.stringify(proposal, null, 2)}\n`, { flag: "wx" });
  return {
    ok: true,
    proposal,
    paths: ["episode-spec.json", "edit-timeline.json", "proposal.json"].map((name) => `${snapshotDir}/${name}`),
  };
}
