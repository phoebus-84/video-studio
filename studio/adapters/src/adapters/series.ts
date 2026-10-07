// ---------------------------------------------------------------------------
// The series-production stages the studio performs (avg-jao.4)
// ---------------------------------------------------------------------------
// Compile, check, sheet (avg-3th.1) and render a spec-driven episode — the same code the agent's
// tools call (@studio/episode), so a stage and a tool never disagree. The
// compiler and the validator are the ones the episode's pinned template
// release names; nothing here chooses them.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideEditTimeline,
  EDIT_TIMELINE_PATH,
  isSpecDriven,
  LAYOUT_SHEET_REPORT,
  layoutSheetStatus,
  makeLayoutSheet,
  renderEpisode,
  writeEditTimeline,
} from "@studio/episode";
import type { AdapterContext, StageAdapter } from "../descriptor.js";

export const SERIES_CHECK_PATH = "artifacts/series-check.json";

/** Every series stage needs the episode's spec; an episode without one belongs to another pipeline. */
function requireSpec(ctx: AdapterContext): void {
  if (!isSpecDriven(ctx.episodeDir)) {
    throw new Error("this pipeline needs an episode-spec.json; run the spec stage");
  }
}

/** Log each located problem, then fail the stage with the error. */
function failWith(ctx: AdapterContext, error: unknown): never {
  const problems = (error as { problems?: { code: string; message: string; path?: string }[] }).problems ?? [];
  for (const p of problems) ctx.log(`    ${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`);
  throw error;
}

export const seriesTimeline: StageAdapter = {
  id: "series-timeline",
  summary: "Compiles the edit timeline with the compiler the spec's template release names, refusing a timeline that breaks the series' rules",
  capability: null,
  provider: "studio",
  produces: ["edit-timeline.json"],
  consumes: ["episode-spec.json", "images/", "takes.json"],
  requires: {},
  async perform(ctx) {
    requireSpec(ctx);
    try {
      const written = writeEditTimeline(ctx.episodeDir, { episodeRef: ctx.ref });
      const by = written.compiledBy;
      ctx.log(`  timeline: ${by?.compiler ?? "?"} from spec revision ${by?.revision ?? "?"}, ${written.timeline.durationInFrames} frames`);
      for (const w of written.warnings) ctx.log(`    ⚠️ ${w}`);
      for (const f of written.validation?.findings ?? []) ctx.log(`    ⚠️ ${f.code} at ${f.path}: ${f.message}`);
      return [join(ctx.episodeDir, EDIT_TIMELINE_PATH)];
    } catch (error) {
      return failWith(ctx, error);
    }
  },
};

export const seriesCheck: StageAdapter = {
  id: "series-check",
  summary: "Checks the timeline a render would use against the series' rules and writes the report a person reviews; errors fail the stage",
  capability: null,
  provider: "studio",
  produces: ["series-check.json"],
  consumes: ["edit-timeline.json"],
  requires: {},
  async perform(ctx) {
    requireSpec(ctx);
    let decision;
    try {
      decision = decideEditTimeline(ctx.episodeDir, { episodeRef: ctx.ref });
    } catch (error) {
      return failWith(ctx, error);
    }
    const findings = decision.validation?.findings ?? [];
    const report = {
      checkedAt: new Date().toISOString(),
      validator: decision.validation?.validator ?? null,
      decision: { rebuilt: decision.rebuilt },
      timeline: { path: EDIT_TIMELINE_PATH, hash: `sha256:${decision.hash}` },
      findings,
    };
    // The report is the reviewer's evidence: written even when it refuses.
    const path = join(ctx.episodeDir, SERIES_CHECK_PATH);
    mkdirSync(join(ctx.episodeDir, "artifacts"), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    renameSync(temp, path);

    const errors = findings.filter((f) => f.severity === "error");
    ctx.log(`  check: ${report.validator ?? "no series rules"} — ${errors.length} error(s), ${findings.length - errors.length} warning(s)`
      + (decision.rebuilt ? `; the timeline would be recompiled: ${decision.rebuilt}` : ""));
    for (const f of findings) ctx.log(`    ${f.severity === "error" ? "❌" : "⚠️"} ${f.code} at ${f.path}: ${f.message}`);
    if (errors.length > 0) {
      throw new Error(`the series rules (${report.validator}) refuse this timeline: see ${SERIES_CHECK_PATH}`);
    }
    return [path];
  },
};

/**
 * What a person reviewed is the timeline the check report names: a stage
 * after the check works on that one, or none — a later edit, even one the
 * rules allow, goes back to review.
 */
function requireCheckedTimeline(ctx: AdapterContext): void {
  const reportPath = join(ctx.episodeDir, SERIES_CHECK_PATH);
  if (!existsSync(reportPath)) {
    throw new Error(`${SERIES_CHECK_PATH} is missing: run the check stage`);
  }
  let checked: unknown;
  try {
    checked = (JSON.parse(readFileSync(reportPath, "utf-8")) as { timeline?: { hash?: unknown } }).timeline?.hash;
  } catch {
    checked = undefined;
  }
  let current: string;
  try {
    current = `sha256:${decideEditTimeline(ctx.episodeDir, { episodeRef: ctx.ref }).hash}`;
  } catch (error) {
    return failWith(ctx, error);
  }
  if (checked !== current) {
    throw new Error(`the timeline changed since it was checked: run the check stage again (${SERIES_CHECK_PATH})`);
  }
}

export const seriesSheet: StageAdapter = {
  id: "series-sheet",
  summary: "Renders the layout sheet of the checked timeline — small stills at the series' instants and a labelled grid of them — for a person to read before the render",
  capability: null,
  provider: "remotion-composer",
  produces: ["layout-sheet.json"],
  consumes: ["edit-timeline.json", "series-check.json"],
  requires: {},
  async perform(ctx) {
    requireSpec(ctx);
    requireCheckedTimeline(ctx);
    try {
      const sheet = await makeLayoutSheet(ctx.episodeDir, { episodeRef: ctx.ref });
      const { report } = sheet;
      ctx.log(`  sheet: ${report.frames.length} frames (${report.sheet.columns}×${report.sheet.rows}), rules ${report.rules.source} → ${sheet.sheetPath}`);
      for (const w of report.warnings) ctx.log(`    ⚠️ ${w}`);
      return [sheet.reportPath, sheet.sheetPath];
    } catch (error) {
      return failWith(ctx, error);
    }
  },
};

export const seriesRender: StageAdapter = {
  id: "series-render",
  summary: "Renders the checked edit timeline, whose layout sheet is current, with Remotion to output/<render-id>.mp4, refusing one that breaks the series' rules",
  capability: "video.compose",
  provider: "remotion-composer",
  produces: ["output.mp4"],
  consumes: ["edit-timeline.json", "series-check.json", "layout-sheet.json"],
  requires: { system: ["ffmpeg"] },
  async perform(ctx) {
    requireSpec(ctx);
    requireCheckedTimeline(ctx);
    // The sheet a person read must show exactly what is about to be rendered.
    const sheet = layoutSheetStatus(ctx.episodeDir, { episodeRef: ctx.ref });
    if (sheet.state !== "current") {
      const why = sheet.state === "missing" ? `missing (${sheet.reason})` : `stale (${sheet.reasons.join("; ")})`;
      throw new Error(`the layout sheet is ${why}: run the sheet stage again (${LAYOUT_SHEET_REPORT})`);
    }
    try {
      const render = await renderEpisode(ctx.episodeDir, { episodeRef: ctx.ref });
      ctx.log(`  render: output/${render.renderId}.mp4 — ${render.result.durationSeconds.toFixed(1)}s, ${render.result.profile}`
        + (render.rebuilt ? `; timeline rebuilt: ${render.rebuilt}` : ""));
      return [render.outputPath];
    } catch (error) {
      return failWith(ctx, error);
    }
  },
};
