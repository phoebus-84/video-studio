// ---------------------------------------------------------------------------
// Filesystem-backed workspace service
// ---------------------------------------------------------------------------
// Scans the library directory for channels, series, and episodes.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { WorkspaceService } from "./service.js";
// These live in the contracts module; service.ts imports them without
// re-exporting, so take them from the source rather than through it.
import type { ChannelSummary, SeriesSummary, EpisodeSummary, EpisodeDetail, EpisodeStatus } from "../contracts/types.js";
import { loadNarrationManifest } from "@studio/adapters";
import {
  SERIES_CONTAINER,
  EPISODES_CONTAINER,
  channelPath,
  seriesContainerPath,
  seriesPath,
  episodesContainerPath,
  episodePath,
} from "@studio/contracts/src/layout.mjs";
import { libraryUrlPath } from "@studio/contracts/src/library-url.mjs";
import { materializeSceneSpine, readSceneSpine } from "./scene-spine.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import type { JournalEventType } from "@studio/contracts/src/journal.mjs";

/**
 * Content directories at a level.
 *
 * Dot-prefixed entries are metadata and underscore-prefixed entries are
 * reserved holding areas; neither is ever content. Nothing else needs
 * excluding, because layout 2 puts series inside `series/` and episodes inside
 * `episodes/`. The denylist of "names that are not a series" this replaces
 * meant adding a `characters/` folder to a channel invented a phantom series.
 */
function isContentDirectory(entry: import("node:fs").Dirent): boolean {
  return entry.isDirectory()
    && !entry.name.startsWith(".")
    && !entry.name.startsWith("_");
}

export class FileSystemWorkspaceService implements WorkspaceService {
  private roots: string[];

  constructor(roots: string[]) {
    this.roots = roots;
  }

  async listChannels(): Promise<ChannelSummary[]> {
    const channels: ChannelSummary[] = [];

    for (const root of this.roots) {
      try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!isContentDirectory(entry)) continue;
          const seriesList = await this.countSeries(path.join(root, entry.name));

          channels.push({
            slug: entry.name,
            title: this.titleFromSlug(entry.name),
            seriesCount: seriesList.length,
          });
        }
      } catch { /* root not accessible */ }
    }

    return channels;
  }

  async listSeries(channel: string): Promise<SeriesSummary[]> {
    const series: SeriesSummary[] = [];

    for (const root of this.roots) {
      // Layout 2: series live in <channel>/series/, never loose in the channel.
      const container = seriesContainerPath(root, channel);
      try {
        const entries = await fs.readdir(container, { withFileTypes: true });
        for (const entry of entries) {
          if (!isContentDirectory(entry)) continue;

          const seriesPath = path.join(container, entry.name);
          const epCount = await this.countEpisodes(seriesPath);

          series.push({
            slug: entry.name,
            title: this.titleFromSlug(entry.name),
            episodeCount: epCount,
          });
        }
      } catch { /* channel not in this root */ }
    }

    return series;
  }

  async listEpisodes(channel: string, series: string): Promise<EpisodeSummary[]> {
    const episodes: EpisodeSummary[] = [];

    for (const root of this.roots) {
      const seriesPath = episodesContainerPath(root, channel, series);
      try {
        const entries = await fs.readdir(seriesPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!isContentDirectory(entry)) continue;

          const epPath = path.join(seriesPath, entry.name);

          const pipeline = this.resolvePipeline(root, channel, series, entry.name);
          episodes.push({
            slug: entry.name,
            title: this.titleFromSlug(entry.name),
            status: await this.detectStatus(epPath),
            pipeline,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch { /* series not found */ }
    }

    return episodes;
  }

  async getEpisode(channel: string, series: string, episode: string): Promise<EpisodeDetail | null> {
    for (const root of this.roots) {
      const epPath = episodePath(root, channel, series, episode);
      // Every asset URL below goes through this. Hand-built template literals
      // here once omitted the `series/` and `episodes/` containers, so the
      // studio requested layout-1 paths and got 404 on every image, narration
      // clip and render — which in the browser reads as "the asset was never
      // generated" rather than "the URL is wrong".
      const urlFor = (relative: string): string =>
        libraryUrlPath({ channel, series, episode }, relative) ?? "";
      try {
        await fs.access(epPath);
        const status = await this.detectStatus(epPath);
        const pipeline = this.resolvePipeline(root, channel, series, episode);
        const base: EpisodeDetail = {
          slug: episode,
          title: this.titleFromSlug(episode),
          status,
          pipeline,
          updatedAt: new Date().toISOString(),
        };

        // The scene list is derived from whatever production left on disk, not
        // read out of artifacts/episode.json. That file is authored empty and
        // nothing ever wrote scenes back into it, so requiring it meant a
        // finished episode displayed no scenes at all — the enrichment below
        // was correct, it simply had nothing to enrich.
        //
        // Materialising first gives the studio's own edits somewhere to land:
        // it saves a prompt by finding the scene by ID in that file, and an
        // empty file drops the write silently. It only ever fills a gap.
        try {
          await materializeSceneSpine(epPath);
        } catch { /* Advisory. A read-only library still displays correctly. */ }
        const rawScenes = await readSceneSpine(epPath);

        try {
          // ── Enrich each scene with narration, asset, captions, and transition data ──
          const canonicalNarration = await loadNarrationManifest(epPath);
          const narrationBySegment = new Map(
            canonicalNarration?.entries.map((entry) => [entry.segmentId, entry]) ?? [],
          );
          const scenes = await Promise.all(rawScenes.map(async (scene: Record<string, unknown>, i: number) => {
            const sid = (scene.id as string) || `s${i + 1}`;
            const enriched: Record<string, unknown> = { ...scene };

            // Canonical manifest first; legacy sidecar remains read-only compatibility.
            const canonicalEntry = narrationBySegment.get(sid);
            if (canonicalEntry) {
              const wavPath = path.isAbsolute(canonicalEntry.wavPath)
                ? canonicalEntry.wavPath
                : path.join(epPath, canonicalEntry.wavPath);
              let wavStat: import("node:fs").Stats | null = null;
              try { wavStat = await fs.stat(wavPath); } catch {}
              enriched.narration = {
                segmentId: canonicalEntry.segmentId,
                file: path.basename(canonicalEntry.wavPath),
                url: urlFor(canonicalEntry.wavPath),
                durationSeconds: canonicalEntry.durationSeconds,
                pauseAfterMs: canonicalEntry.pauseAfterMs,
                acceptedAttemptId: canonicalEntry.acceptedAttemptId,
                source: "narration-manifest",
                status: wavStat ? "completed" : "missing",
                generatedAt: wavStat ? wavStat.mtime.toISOString() : null,
                size: wavStat ? wavStat.size : null,
              };
            } else {
              try {
                const narJsonPath = path.join(epPath, "artifacts", "narration", `${sid}.json`);
                const narRaw = await fs.readFile(narJsonPath, "utf-8");
                const narMeta = JSON.parse(narRaw);
                const wavPath = path.join(epPath, "artifacts", "narration", `${sid}.wav`);
                let wavStat: import("node:fs").Stats | null = null;
                try { wavStat = await fs.stat(wavPath); } catch {}
                enriched.narration = {
                  file: `${sid}.wav`,
                  url: urlFor(`artifacts/narration/${sid}.wav`),
                  durationSeconds: (narMeta.duration_sec as number) ?? scene.durationSeconds ?? 0,
                  voice: (narMeta.voice as string) || "default",
                  jobId: narMeta.job_id as string,
                  source: "legacy-sidecar",
                  deprecated: true,
                  status: wavStat ? "completed" : "missing",
                  generatedAt: wavStat ? wavStat.mtime.toISOString() : null,
                  size: wavStat ? wavStat.size : null,
                };
              } catch {
                enriched.narration = null;
              }
            }

            // Asset: check for image files in assets/images/ and video files in assets/tapes/
            try {
              const imageDirs = [
                path.join(epPath, "assets", "images"),
                path.join(epPath, "artifacts"), // backward compat
              ];
              const tapeDir = path.join(epPath, "assets", "tapes");
              const imageExts = ["jpg", "jpeg", "png", "webp"];
              const videoExts = ["mp4", "webm"];

              let foundAsset: Record<string, unknown> | null = null;

              // Check video first (preferred for terminal demo scenes)
              for (const ext of videoExts) {
                const videoPath = path.join(tapeDir, `${sid}.${ext}`);
                try {
                  const stat = await fs.stat(videoPath);
                  foundAsset = {
                    file: `${sid}.${ext}`,
                    url: urlFor(`assets/tapes/${sid}.${ext}`),
                    size: stat.size,
                    generatedAt: stat.mtime.toISOString(),
                    kind: "video",
                  };
                  break;
                } catch {}
              }

              // Fall back to image
              if (!foundAsset) {
                for (const dir of imageDirs) {
                  for (const ext of imageExts) {
                    const imgPath = path.join(dir, `${sid}.${ext}`);
                    try {
                      const stat = await fs.stat(imgPath);
                      foundAsset = {
                        file: `${sid}.${ext}`,
                        url: urlFor(`${path.relative(epPath, path.dirname(imgPath))}/${sid}.${ext}`),
                        size: stat.size,
                        generatedAt: stat.mtime.toISOString(),
                        kind: "image",
                      };
                      break;
                    } catch {}
                  }
                  if (foundAsset) break;
                }
              }
              enriched.asset = foundAsset;
            } catch {
              enriched.asset = null;
            }

            // Captions: parse SRT for this scene's segments
            try {
              const srtPath = path.join(epPath, "artifacts", "captions.srt");
              const srtRaw = await fs.readFile(srtPath, "utf-8");
              const captions = parseSrtForScene(
                srtRaw,
                (scene.startSeconds as number) || 0,
                (scene.durationSeconds as number) || 0,
              );
              enriched.captions = captions.length > 0 ? { segments: captions, count: captions.length } : null;
            } catch {
              enriched.captions = null;
            }

            // Transition: from scene definition
            enriched.transition = (scene as any).transition ?? null;

            return enriched;
          }));

          // ── Render deliverable: output/<render-id>.mp4 (canonical) or artifacts/final.mp4 (legacy) ──
          let render: Record<string, unknown> | null = null;
          try {
            const candidates: Array<{ p: string; url: string; mtime: number }> = [];
            try {
              const outDir = path.join(epPath, "output");
              for (const f of (await fs.readdir(outDir)).filter((f) => f.endsWith(".mp4"))) {
                const p = path.join(outDir, f);
                candidates.push({ p, url: urlFor(`output/${f}`), mtime: (await fs.stat(p)).mtimeMs });
              }
            } catch { /* no output dir */ }
            try {
              const p = path.join(epPath, "artifacts", "final.mp4");
              candidates.push({ p, url: urlFor("artifacts/final.mp4"), mtime: (await fs.stat(p)).mtimeMs });
            } catch { /* no legacy render */ }
            const latest = candidates.sort((a, b) => b.mtime - a.mtime)[0];
            if (latest) {
              const stat = await fs.stat(latest.p);
              render = { url: latest.url, file: path.basename(latest.p), size: stat.size, generatedAt: stat.mtime.toISOString() };
            }
          } catch { /* discovery failed */ }

          // ── Animation beats fall back to the episode render as their asset ──
          // Rigged-vector episodes have one continuous animated clip rather than
          // per-scene images; each beat still previews the current render.
          if (render) {
            for (const scene of scenes as Array<Record<string, any>>) {
              if (!scene.asset && scene.kind === "animation") {
                scene.asset = { kind: "video", url: render.url, file: render.file, size: render.size, generatedAt: render.generatedAt };
              }
            }
          }

          // ── QA report (only if a real report file exists on disk) ──
          let qaReport: Record<string, unknown> | null = null;
          const reportPaths = [path.join(epPath, "artifacts", "qa-report.json")];
          if (render) {
            reportPaths.push(path.join(epPath, "output", `${path.basename(render.file as string, ".mp4")}.report.json`));
          }
          for (const rp of reportPaths) {
            try { qaReport = JSON.parse(await fs.readFile(rp, "utf-8")) as Record<string, unknown>; break; } catch { /* try next */ }
          }

          return { ...base, scenes, render, qaReport, slug: episode, status, updatedAt: new Date().toISOString() };
        } catch {
          return base;
        }
      } catch { /* not found */ }
    }
    return null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Resolve the pipeline name for an episode by reading series pipeline.yaml. */
  private resolvePipeline(root: string, channel: string, series: string, episode: string): string {
    // 1. Try episode-level pipeline.yaml
    const epPipeline = path.join(episodePath(root, channel, series, episode), "pipeline.yaml");
    try {
      const raw = readFileSync(epPipeline, "utf-8");
      const doc = yaml.parse(raw) as Record<string, unknown> | null;
      if (doc?.pipeline) return String(doc.pipeline);
    } catch { /* no episode pipeline */ }

    // 2. Try series-level pipeline.yaml
    const seriesPipeline = path.join(seriesPath(root, channel, series), "pipeline.yaml");
    try {
      const raw = readFileSync(seriesPipeline, "utf-8");
      const doc = yaml.parse(raw) as Record<string, unknown> | null;
      if (doc?.pipeline) return String(doc.pipeline);
    } catch { /* no series pipeline */ }

    // 3. Try channel-level pipeline.yaml
    const chPipeline = path.join(channelPath(root, channel), "pipeline.yaml");
    try {
      const raw = readFileSync(chPipeline, "utf-8");
      const doc = yaml.parse(raw) as Record<string, unknown> | null;
      if (doc?.pipeline) return String(doc.pipeline);
    } catch { /* no channel pipeline */ }

    return "narrated-illustrated-video"; // default fallback
  }

  private async countSeries(channelPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(path.join(channelPath, SERIES_CONTAINER), {
        withFileTypes: true,
      });
      return entries.filter(isContentDirectory).map((e) => e.name);
    } catch { return []; }
  }

  private async countEpisodes(seriesPath: string): Promise<number> {
    try {
      const entries = await fs.readdir(path.join(seriesPath, EPISODES_CONTAINER), {
        withFileTypes: true,
      });
      return entries.filter(isContentDirectory).length;
    } catch { return 0; }
  }

  /**
   * Derive an episode's status from what is on disk.
   *
   * Returns the canonical EpisodeStatus vocabulary. This previously returned
   * "in-progress" and "pending", neither of which is a member of that union,
   * so the gateway was emitting statuses the browser's own types said could
   * not occur. The mapping is: nothing started -> idle, work present but no
   * approved render -> running, approved QA or a finished mp4 -> completed.
   */
  private async detectStatus(epPath: string): Promise<EpisodeStatus> {
    try {
      const qa = JSON.parse(await fs.readFile(path.join(epPath, "artifacts", "qa-report.json"), "utf-8")) as { approved?: unknown };
      if (qa.approved === true) return "completed";
    } catch { /* no approved QA report */ }

    try {
      const pointer = JSON.parse(await fs.readFile(path.join(epPath, "output", "current.json"), "utf-8")) as { path?: unknown };
      if (typeof pointer.path === "string" && !path.isAbsolute(pointer.path) && !pointer.path.includes("..")) {
        await fs.access(path.join(epPath, "output", pointer.path));
        return "running";
      }
    } catch { /* no canonical render */ }

    try { await fs.access(path.join(epPath, "artifacts", "output.mp4")); return "completed"; } catch {}
    for (const marker of ["production-profile.json", "visual-beats.json", "script.md"]) {
      try { await fs.access(path.join(epPath, "artifacts", marker)); return "running"; } catch {}
    }
    return "idle";
  }

  private titleFromSlug(slug: string): string {
    return slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * The episode's journal.
   *
   * This used to look in `reviews/` for loose `.json` files, at a hand-joined
   * pre-migration path, in the first root only — so it never opened
   * `journal/events.jsonl`, which is the file the schema describes, the route
   * advertises and the Pi tool asks for. Between that and the missing writer,
   * the journal was unreadable and unwritten at the same time, and each half
   * hid the other.
   */
  async findEvents(
    ref: { channel: string; series: string; episode: string },
    query: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    // A caller may pass any string here; an unrecognised one is not a runtime
    // error — parseJournal simply matches nothing, same as before this typed
    // the parameter.
    const type = (typeof query.type === "string" ? query.type : undefined) as JournalEventType | undefined;
    const rawLimit = Number(query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 0 ? rawLimit : 50;

    for (const root of this.roots) {
      const journal = path.join(
        episodePath(root, ref.channel, ref.series, ref.episode),
        JOURNAL_RELATIVE_PATH,
      );
      try {
        const events = parseJournal(await fs.readFile(journal, "utf-8"), { type, limit });
        return events as unknown as Array<Record<string, unknown>>;
      } catch { /* not in this root */ }
    }
    return [];
  }
}

// ── SRT Parser ────────────────────────────────────────────────────────────

interface SrtSegment {
  index: number;
  start: string;
  end: string;
  text: string;
}

/** Parse an SRT file and filter segments for a specific scene prefix. */
function parseSrtForScene(
  srt: string,
  /** Where the scene begins on the episode timeline, in seconds. */
  sceneStart: number,
  /** How long it runs. Zero means the episode has no timing to match against. */
  sceneDuration: number,
): Array<{ time: string; text: string }> {
  const segments: SrtSegment[] = [];
  const blocks = srt.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const index = parseInt(lines[0]!, 10);
    if (isNaN(index)) continue;
    const timeMatch = lines[1]?.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
    if (!timeMatch) continue;
    const text = lines.slice(2).join(" ").trim();
    segments.push({ index, start: timeMatch[1]!, end: timeMatch[2]!, text });
  }

  if (segments.length === 0) return [];

  // Cues are assigned to the scene whose window contains them. This used to
  // divide them by index across a hardcoded eight scenes —
  // `Math.ceil(segments.length / 8) // assume 8 scenes` — so an eleven-scene
  // episode gave its first eight scenes five cues each and scenes nine, ten and
  // eleven none at all, indexing past the end of the list. The cues carry real
  // timestamps and the scene carries a real window, so neither has to be
  // guessed at.
  const start = sceneStart;
  const end = sceneDuration > 0 ? sceneStart + sceneDuration : Infinity;
  const within = segments.filter((segment) => {
    const at = srtSecondsOf(segment.start);
    return at !== null && at >= start - CAPTION_EDGE_TOLERANCE_SECONDS && at < end;
  });

  // A scene with no window to match against — no timing anywhere in the
  // episode — still shows the whole transcript rather than nothing.
  const chosen = sceneDuration > 0 ? within : segments;
  return chosen.map((segment) => ({ time: segment.start, text: segment.text }));
}

/** A cue that begins a hair before its scene still belongs to it. */
const CAPTION_EDGE_TOLERANCE_SECONDS = 0.001;

/** `00:01:29,833` — SRT allows either a comma or a dot before the milliseconds. */
export function srtSecondsOf(stamp: string): number | null {
  const match = /^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})$/.exec(stamp.trim());
  if (!match) return null;
  return (
    Number(match[1]) * 3600
    + Number(match[2]) * 60
    + Number(match[3])
    + Number(match[4]) / 1000
  );
}
