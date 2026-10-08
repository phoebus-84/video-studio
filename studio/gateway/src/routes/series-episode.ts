// ---------------------------------------------------------------------------
// A series episode in the web studio (avg-goz)
// ---------------------------------------------------------------------------
// A spec-driven episode (episode-spec.json) has a layout sheet to review and
// narration takes to hear. These routes read them for the Storyboard and
// Narration tabs, and sign the operator's review of the sheet — the same
// runtime call as `vpr sheet approve|reject`, with the gateway's operator
// key, only for a request the operator key authenticated. Nothing else here
// writes.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { reviewSheet, sheetReviewStatus } from "@studio/runtime";
import { ErrorCode, GatewayError } from "../errors/index.js";

interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHEET_DIR = "artifacts/layout-sheet";
const TAKES = "artifacts/narration/takes.json";

function parseEpisode(params: Record<string, string>): EpisodeRef {
  const ref = { channel: params.channel ?? "", series: params.series ?? "", episode: params.episode ?? "" };
  if (![ref.channel, ref.series, ref.episode].every((part) => SLUG.test(part))) {
    throw new GatewayError({ code: ErrorCode.BAD_REQUEST, message: "channel, series and episode must be slugs" });
  }
  return ref;
}

const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
};

// The names a sheet's files may have, as the runtime's review holds them; and
// the one timeline a sheet pictures.
const SHEET_IMAGE = /^sheet\.jpg$/;
const STILL = /^frames\/\d{3}\.jpg$/;
const TIMELINE = "artifacts/edit-timeline.json";

/**
 * The layout sheet as the web shows it: its stills, and whether the stored
 * timeline moved since. A sheet made for a timeline the render would rebuild
 * (`rebuilt`), or before any was stored, pictured no stored file: that is
 * not a change — the render gate checks the rest. A sheet.json naming files
 * outside the sheet, or another timeline, is no sheet (`invalid`).
 */
export function layoutSheetOf(dir: string): { sheet: null; timelineChanged: false; invalid?: string } | { sheet: SheetView; timelineChanged: boolean } {
  const report = readJson(join(dir, SHEET_DIR, "sheet.json"));
  if (!report?.sheet || !Array.isArray(report.frames)) return { sheet: null, timelineChanged: false };
  const frames = report.frames as { index: number; frame: number; seconds: number; label: string; path: unknown }[];
  if (typeof report.sheet.path !== "string" || !SHEET_IMAGE.test(report.sheet.path)
    || !frames.every((f) => typeof f?.path === "string" && STILL.test(f.path))
    || (report.timeline?.path !== undefined && report.timeline.path !== TIMELINE)) {
    return { sheet: null, timelineChanged: false, invalid: "sheet.json names files outside the sheet: make the sheet again" };
  }
  const timelineFile = join(dir, TIMELINE);
  const timelineChanged = !report.rebuilt && existsSync(timelineFile) && sha256(readFileSync(timelineFile)) !== report.timeline?.hash;
  return {
    sheet: {
      createdAt: report.createdAt ?? null,
      scale: report.scale ?? null,
      columns: report.sheet.columns ?? null,
      rows: report.sheet.rows ?? null,
      grid: { path: `${SHEET_DIR}/${report.sheet.path}`, hash: report.sheet.hash },
      rules: report.rules?.source ?? null,
      frames: frames.map(({ index, frame, seconds, label, path }) => ({ index, frame, seconds, label, path: `${SHEET_DIR}/${path as string}` })),
    },
    timelineChanged,
  };
}

interface SheetView {
  createdAt: string | null;
  scale: number | null;
  columns: number | null;
  rows: number | null;
  grid: { path: string; hash: string };
  rules: string | null;
  frames: { index: number; frame: number; seconds: number; label: string; path: string }[];
}

interface TakeView {
  id: string;
  text: string;
  spokenText?: string;
  language?: string;
  role?: string;
  voice: unknown;
  durationSeconds: number | null;
  audio: (EpisodeRef & { path: string }) | null;
  words: { text: string; start: number; end: number }[] | null;
}

/** An episode's takes.json, each take with its audio's place and its timing's words. */
function takesOf(dir: string, ref: EpisodeRef): { units: unknown[]; takes: TakeView[] } {
  const doc = readJson(join(dir, TAKES));
  if (!doc || !Array.isArray(doc.takes)) return { units: [], takes: [] };
  const takes = (doc.takes as any[]).map((take): TakeView => {
    const timing = typeof take.timing?.path === "string" && !take.timing.path.includes("..") ? readJson(join(dir, take.timing.path)) : null;
    const words = Array.isArray(timing?.words)
      ? (timing.words as any[]).filter((w) => typeof w?.text === "string").map((w) => ({ text: w.text as string, start: Number(w.start), end: Number(w.end) }))
      : null;
    const audioPath = typeof take.audio?.path === "string" && !take.audio.path.includes("..") ? take.audio.path as string : null;
    return {
      id: take.id,
      text: take.text,
      ...(take.spokenText !== undefined ? { spokenText: take.spokenText } : {}),
      ...(take.language !== undefined ? { language: take.language } : {}),
      ...(take.role !== undefined ? { role: take.role } : {}),
      voice: take.voice ?? null,
      durationSeconds: typeof take.audio?.durationSeconds === "number" ? take.audio.durationSeconds : null,
      audio: audioPath ? { ...ref, path: audioPath } : null,
      words,
    };
  });
  return { units: Array.isArray(doc.units) ? doc.units : [], takes };
}

/** The episodes this one pins as its source (ADR-0035), and their takes, read-only. */
function sourcesOf(libraryRoot: string, dir: string, ref: EpisodeRef) {
  const pinsDir = join(dir, "source", "pins");
  if (!existsSync(pinsDir)) return [];
  return readdirSync(pinsDir).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort().flatMap((name) => {
    const pin = readJson(join(pinsDir, name));
    const source = pin?.source;
    if (source?.kind !== "episode" || !SLUG.test(source.series ?? "") || !SLUG.test(source.episode ?? "")) return [];
    const sourceRef = { channel: ref.channel, series: source.series as string, episode: source.episode as string };
    const sourceDir = episodePath(libraryRoot, sourceRef.channel, sourceRef.series, sourceRef.episode);
    return [{ pin: pin.id as string, episode: sourceRef, ...takesOf(sourceDir, sourceRef) }];
  });
}

export function registerSeriesEpisodeRoutes(app: FastifyInstance, options: { libraryRoot: string; operatorKey: string | null }): void {
  const { libraryRoot, operatorKey } = options;
  const dirOf = (ref: EpisodeRef) => episodePath(libraryRoot, ref.channel, ref.series, ref.episode);
  const episodeParams = {
    type: "object",
    required: ["channel", "series", "episode"],
    properties: { channel: { type: "string" }, series: { type: "string" }, episode: { type: "string" } },
  };

  app.get("/api/channels/:channel/series/:series/episodes/:episode/layout-sheet", {
    schema: { description: "A spec-driven episode's layout sheet, its stills and its review.", tags: ["series"], params: episodeParams },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const dir = dirOf(ref);
    const specDriven = existsSync(join(dir, "episode-spec.json"));
    const shown = layoutSheetOf(dir);
    if (!shown.sheet) {
      const invalid = "invalid" in shown ? shown.invalid : undefined;
      return { specDriven, sheet: null, timelineChanged: false, review: invalid ? { state: "invalid", message: invalid } : { state: "no-sheet", message: "no layout sheet yet" } };
    }
    // The verdict says whether the review holds; the review itself says when, by whom, and why.
    const status = sheetReviewStatus({ libraryRoot, ref, key: operatorKey });
    const signed = status.state === "approved" || status.state === "rejected" ? readJson(join(dir, SHEET_DIR, "review.json")) : null;
    const review = {
      ...status,
      ...(signed ? { at: signed.at ?? null, actor: signed.actor ?? null, note: signed.note ?? null } : {}),
    };
    return { specDriven, sheet: shown.sheet, timelineChanged: shown.timelineChanged, review };
  });

  app.post("/api/channels/:channel/series/:series/episodes/:episode/layout-sheet/review", {
    schema: {
      description: "The operator's review of the layout sheet now on disk: approved, or rejected with a note. Only for the operator key.",
      tags: ["series"],
      params: episodeParams,
      body: {
        type: "object",
        required: ["decision", "sheetHash"],
        properties: {
          decision: { type: "string", enum: ["approved", "rejected"] },
          note: { type: "string" },
          sheetHash: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const { decision, note, sheetHash } = request.body as { decision: "approved" | "rejected"; note?: string; sheetHash: string };
    if ((request as { principal?: string }).principal !== "operator" || !operatorKey) {
      return reply.status(403).send({ error: "operator-only", message: "only the operator reviews a sheet: sign in as operator" });
    }
    if (decision === "rejected" && !note?.trim()) {
      return reply.status(400).send({ error: "note-required", message: "a rejected sheet needs a note saying what is wrong" });
    }
    const { sheet } = layoutSheetOf(dirOf(ref));
    if (!sheet || sheet.grid.hash !== sheetHash) {
      return reply.status(409).send({ error: "sheet-changed", message: "the sheet changed since it was shown: look at it again" });
    }
    const outcome = reviewSheet({ libraryRoot, ref, key: operatorKey, decision, ...(note?.trim() ? { note: note.trim() } : {}) });
    if (!outcome.ok) return reply.status(409).send({ error: outcome.code, message: outcome.message });
    return { ok: true, review: outcome.value.review };
  });

  app.get("/api/channels/:channel/series/:series/episodes/:episode/narration-takes", {
    schema: { description: "A spec-driven episode's narration takes, their audio and words, and its pinned sources' takes.", tags: ["series"], params: episodeParams },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const dir = dirOf(ref);
    return { specDriven: existsSync(join(dir, "episode-spec.json")), ...takesOf(dir, ref), sources: sourcesOf(libraryRoot, dir, ref) };
  });
}
