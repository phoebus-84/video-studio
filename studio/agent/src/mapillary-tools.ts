// ---------------------------------------------------------------------------
// Mapillary street-level imagery (CC BY-SA 4.0): coverage and geometry, the
// best still near a place, a hyperlapse along a sequence, a pan inside a 360°
// image, a tiny planet. Production outputs land in the workspace with chained
// provenance and the share-alike credit.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createMapillary, type Mapillary } from "@av/archive-media";
import { renderMapillaryHyperlapse, renderMapillaryPan, renderMapillaryPlanet, saveMapillaryStill, sequenceGeoJson } from "@studio/episode";
import { join } from "node:path";
import { WORKSPACE_PARAMS, workspaceOf } from "./workspace-target.js";
import { ARCHIVE_ENV_KEYS, readEnv } from "./config.js";

const USER_AGENT = "video-studio-archive-media/0.1 (https://github.com/phoebus-84/video-studio)";
const fail = (error: unknown) => ({
  content: [{ type: "text" as const, text: `❌ ${error instanceof Error ? error.message : String(error)}` }],
  details: {} as Record<string, unknown>,
  isError: true as unknown as boolean,
});

export function registerMapillaryTools(pi: ExtensionAPI, options: { mapillary?: Mapillary } = {}): void {
  const libraryRoot = () => process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");
  let shared: Mapillary | undefined = options.mapillary;
  const map = async () => {
    if (!shared) {
      const keys = await readEnv();
      shared = createMapillary({ userAgent: USER_AGENT, env: Object.fromEntries(ARCHIVE_ENV_KEYS.map((key) => [key, keys[key]])) });
    }
    return shared;
  };
  const need = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`${name} is required for this action`);
    return value;
  };

  pi.registerTool({
    name: "pva_mapillary",
    label: "Mapillary",
    description:
      "Mapillary street-level imagery (CC BY-SA 4.0; needs MAPILLARY_TOKEN). Query: coverage (sequences around a place, ranked by their best straight run), sequence (one sequence's length and runs), photo (best photos near a point), history (the same spot across years), features (map objects/traffic signs), detections (classes in one image). Produce into an episode: still (one image, optionally the 9:16 360° reprojection), hyperlapse (a sequence to 1080×1920 MP4), pan (a camera turn inside a 360° image), planet (a tiny planet still or spinning video). Produced files carry chained provenance and the CC BY-SA credit; the fetched originals are never altered.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      action: StringEnum(["coverage", "sequence", "photo", "history", "features", "detections", "still", "hyperlapse", "pan", "planet"]),
      query: Type.Optional(Type.String({ description: "A place name ('Via Cavour, Roma') or 'lat,lng', for coverage/photo/history/features" })),
      seq: Type.Optional(Type.String({ description: "Sequence id, from coverage" })),
      id: Type.Optional(Type.String({ description: "Image id, for still/detections/pan/planet" })),
      name: Type.Optional(Type.String({ description: "Asset id for still/hyperlapse/pan/planet" })),
      radius: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "Metres around the point, default 150" })),
      pano: Type.Optional(Type.Boolean({ description: "coverage/photo: 360° only (false = flat only)" })),
      since: Type.Optional(Type.Integer({ description: "coverage/photo: earliest year" })),
      until: Type.Optional(Type.Integer({ description: "coverage/photo: latest year" })),
      heading: Type.Optional(Type.Number({ description: "photo/history: compass heading to face" })),
      kind: Type.Optional(StringEnum(["all", "signs", "objects"], { description: "features filter" })),
      filter: Type.Optional(Type.String({ description: "features: substring of the value" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      start: Type.Optional(Type.Integer({ minimum: 0, description: "hyperlapse: first image index" })),
      end: Type.Optional(Type.Integer({ minimum: 0, description: "hyperlapse: last image index" })),
      reverse: Type.Optional(Type.Boolean({ description: "hyperlapse: walk backwards" })),
      durationSeconds: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "hyperlapse default images/12; pan default 6; planet: spinning" })),
      fps: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
      yaw: Type.Optional(Type.Number({ description: "360°: degrees added to the walking direction / absolute for still and planet" })),
      turn: Type.Optional(Type.Number({ description: "pan/planet: degrees turned over the duration" })),
      pitch: Type.Optional(Type.Number({ description: "360°: look up (+) / down (-), default 9" })),
      fov: Type.Optional(Type.Number({ description: "360°: vertical field of view, default 89" })),
      vertical: Type.Optional(Type.Boolean({ description: "still: the 9:16 reprojection/crop" })),
      interp: Type.Optional(StringEnum(["mci", "blend", "none"], { description: "hyperlapse frame interpolation" })),
      geojson: Type.Optional(Type.Boolean({ description: "sequence: also write the path as GeoJSON into artifacts/" })),
    }),
    async execute(_id, params) {
      try {
        const m = await map();
        const query = params.query;
        switch (params.action) {
          case "coverage": {
            const got = await m.coverage(need(query, "query"), { ...(params.radius ? { radius: params.radius } : {}), ...(params.pano !== undefined ? { pano: params.pano } : {}), ...(params.since ? { since: params.since } : {}), ...(params.until ? { until: params.until } : {}), ...(params.limit ? { limit: params.limit } : {}) });
            return { content: [{ type: "text" as const, text: [`${got.images} images, ${got.sequences.length} sequences within ${got.radius} m of ${got.place} [${got.center}]`, ...got.sequences.map((r) => `- ${r.ref} ${r.pano ? "360" : r.size} ${r.date} ${r.images} img; run ${r.run.images} img/${r.run.meters} m → ${r.run.bearing}° ${r.creator}${r.quality !== null ? ` q${r.quality}` : ""}`)].join("\n") }], details: got as unknown as Record<string, unknown> };
          }
          case "sequence": {
            const got = await m.coverageOfSequence(need(params.seq, "seq"));
            let saved: string | undefined;
            if (params.geojson) {
              const ws = workspaceOf(libraryRoot(), params);
              const { mkdirSync, writeFileSync } = await import("node:fs");
              const { join } = await import("node:path");
              mkdirSync(join(ws.dir, "artifacts"), { recursive: true });
              saved = `artifacts/mapillary-${got.sequence}-path.geojson`;
              writeFileSync(join(ws.dir, saved), sequenceGeoJson(got.images_raw, got.sequence));
            }
            const { images_raw: _raw, ...rest } = got;
            return { content: [{ type: "text" as const, text: [`${got.ref} ${got.pano ? "360" : "flat"} ${got.images} img ${got.meters} m ${got.from} ${got.creator} ${got.page}`, ...got.runs.map((r, k) => `run #${k} start ${r.from} end ${r.to}: ${r.images} img / ${r.meters} m → ${r.bearing}°`), ...(saved ? [`geojson ${saved}`] : [])].join("\n") }], details: rest as unknown as Record<string, unknown> };
          }
          case "photo": {
            const got = await m.photo(need(query, "query"), { ...(params.radius ? { radius: params.radius } : {}), ...(params.pano !== undefined ? { pano: params.pano } : {}), ...(params.heading !== undefined ? { heading: params.heading } : {}), ...(params.since ? { since: params.since } : {}), ...(params.until ? { until: params.until } : {}), ...(params.limit ? { limit: params.limit } : {}) });
            const { images_raw: _raw, ...rest } = got;
            return { content: [{ type: "text" as const, text: [`${got.photos.length} photos near ${got.place}`, ...got.photos.map((r) => `- ${r.ref} ${r.date} ${r.pano ? "360" : `${r.size} ${r.heading}°`} ${r.creator}${r.q !== undefined ? ` q${r.q}` : ""}`)].join("\n") }], details: rest as unknown as Record<string, unknown> };
          }
          case "history": {
            const got = await m.history(need(query, "query"), { ...(params.radius ? { radius: params.radius } : {}), ...(params.heading !== undefined ? { heading: params.heading } : {}) });
            return { content: [{ type: "text" as const, text: [`${got.place}: ${got.years.length} years`, ...got.years.map((r) => `- ${r.year} ${r.ref} ${r.date} ${r.m} m ${r.pano ? "360" : `${r.heading}°`} ${r.creator} (${r.count})`)].join("\n") }], details: got as unknown as Record<string, unknown> };
          }
          case "features": {
            const got = await m.features(need(query, "query"), { ...(params.radius ? { radius: params.radius } : {}), ...(params.kind ? { kind: params.kind as "all" | "signs" | "objects" } : {}), ...(params.filter ? { filter: params.filter } : {}), ...(params.limit ? { limit: params.limit } : {}) });
            return { content: [{ type: "text" as const, text: [`${got.features} features near ${got.place}`, ...got.values.map((r) => `${String(r.count).padStart(4)} ${r.value} ${r.first}→${r.last}`)].join("\n") }], details: got as unknown as Record<string, unknown> };
          }
          case "detections": {
            const got = await m.detections(need(params.id, "id"), params.limit ?? 10);
            return { content: [{ type: "text" as const, text: [`${got.ref}: ${got.detections} detections`, ...got.values.map(([v, n]) => `${String(n).padStart(4)} ${v}`)].join("\n") }], details: got as unknown as Record<string, unknown> };
          }
          case "still":
          case "hyperlapse":
          case "pan":
          case "planet": {
            const ws = workspaceOf(libraryRoot(), params);
            const name = need(params.name, "name");
            const common = { ...(params.durationSeconds ? { durationSeconds: params.durationSeconds } : {}), ...(params.fps ? { fps: params.fps } : {}), ...(params.yaw !== undefined ? { yaw: params.yaw } : {}) };
            const got = params.action === "still"
              ? await saveMapillaryStill(m, ws.dir, need(params.id, "id"), name, { ...(params.vertical ? { vertical: true } : {}), ...(params.yaw !== undefined ? { yaw: params.yaw } : {}), ...(params.pitch !== undefined ? { pitch: params.pitch } : {}), ...(params.fov !== undefined ? { fov: params.fov } : {}) })
              : params.action === "hyperlapse"
                ? await renderMapillaryHyperlapse(m, ws.dir, need(params.seq, "seq"), name, { ...common, ...(params.start !== undefined ? { start: params.start } : {}), ...(params.end !== undefined ? { end: params.end } : {}), ...(params.reverse ? { reverse: true } : {}), ...(params.pitch !== undefined ? { pitch: params.pitch } : {}), ...(params.fov !== undefined ? { fov: params.fov } : {}), ...(params.interp ? { interp: params.interp as "mci" | "blend" | "none" } : {}) })
                : params.action === "pan"
                  ? await renderMapillaryPan(m, ws.dir, need(params.id, "id"), name, { ...common, ...(params.turn !== undefined ? { turn: params.turn } : {}), ...(params.pitch !== undefined ? { pitch: params.pitch } : {}), ...(params.fov !== undefined ? { fov: params.fov } : {}) })
                  : await renderMapillaryPlanet(m, ws.dir, need(params.id, "id"), name, { ...common, ...(params.turn !== undefined ? { turn: params.turn } : {}) });
            return { content: [{ type: "text" as const, text: `✅ ${got.path}; provenance ${got.recordPath}. Credit required: Mapillary (CC BY-SA 4.0), share-alike applies.` }], details: got as unknown as Record<string, unknown> };
          }
        }
        throw new Error(`unsupported action: ${String(params.action)}`);
      } catch (error) {
        return fail(error);
      }
    },
  });
}
