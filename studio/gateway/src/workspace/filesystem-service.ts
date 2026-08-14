// ---------------------------------------------------------------------------
// Filesystem-backed workspace service
// ---------------------------------------------------------------------------
// Scans the library directory for channels, series, and episodes.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import type { WorkspaceService, ChannelSummary, SeriesSummary, EpisodeSummary } from "./service.js";
import { loadNarrationManifest } from "../runtime/narration-manifest.js";

const SERIES_SUPPORT_DIRECTORIES = new Set([
  "assets",
  "pipelines",
  "rigs",
  "shared-assets",
  "skills",
  "sources",
  "templates",
  "voice-profiles",
]);

function isEpisodeDirectory(entry: import("node:fs").Dirent): boolean {
  return entry.isDirectory()
    && !entry.name.startsWith(".")
    && !SERIES_SUPPORT_DIRECTORIES.has(entry.name);
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
          if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

          const channelPath = path.join(root, entry.name);
          const seriesList = await this.countSeries(channelPath);

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
      const channelPath = path.join(root, channel);
      try {
        const entries = await fs.readdir(channelPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

          const seriesPath = path.join(channelPath, entry.name);
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
      const seriesPath = path.join(root, channel, series);
      try {
        const entries = await fs.readdir(seriesPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!isEpisodeDirectory(entry)) continue;

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

  async getEpisode(channel: string, series: string, episode: string): Promise<EpisodeSummary | null> {
    for (const root of this.roots) {
      const epPath = path.join(root, channel, series, episode);
      try {
        await fs.access(epPath);
        const status = await this.detectStatus(epPath);
        const pipeline = this.resolvePipeline(root, channel, series, episode);
        const base: EpisodeSummary = {
          slug: episode,
          title: this.titleFromSlug(episode),
          status,
          pipeline,
          updatedAt: new Date().toISOString(),
        };

        // Try to read episode.json for richer data (in artifacts/ subdir)
        try {
          const metaPath = path.join(epPath, "artifacts", "episode.json");
          const raw = await fs.readFile(metaPath, "utf-8");
          const meta = JSON.parse(raw);
          // episode.json is a scenes array — wrap it
          const rawScenes = Array.isArray(meta) ? meta : (meta.scenes ?? []);

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
                url: `/library/${channel}/${series}/${episode}/${canonicalEntry.wavPath}`,
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
                  url: `/library/${channel}/${series}/${episode}/artifacts/narration/${sid}.wav`,
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
                    url: `/library/${channel}/${series}/${episode}/assets/tapes/${sid}.${ext}`,
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
                        url: `/library/${channel}/${series}/${episode}/${path.relative(epPath, path.dirname(imgPath))}/${sid}.${ext}`,
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
              const captions = parseSrtForScene(srtRaw, sid, scene.durationSeconds as number || 0);
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
                candidates.push({ p, url: `/library/${channel}/${series}/${episode}/output/${f}`, mtime: (await fs.stat(p)).mtimeMs });
              }
            } catch { /* no output dir */ }
            try {
              const p = path.join(epPath, "artifacts", "final.mp4");
              candidates.push({ p, url: `/library/${channel}/${series}/${episode}/artifacts/final.mp4`, mtime: (await fs.stat(p)).mtimeMs });
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
          let qaReport: unknown = null;
          const reportPaths = [path.join(epPath, "artifacts", "qa-report.json")];
          if (render) {
            reportPaths.push(path.join(epPath, "output", `${path.basename(render.file as string, ".mp4")}.report.json`));
          }
          for (const rp of reportPaths) {
            try { qaReport = JSON.parse(await fs.readFile(rp, "utf-8")); break; } catch { /* try next */ }
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
    const epPipeline = path.join(root, channel, series, episode, "pipeline.yaml");
    try {
      const raw = readFileSync(epPipeline, "utf-8");
      const doc = yaml.parse(raw) as Record<string, unknown> | null;
      if (doc?.pipeline) return String(doc.pipeline);
    } catch { /* no episode pipeline */ }

    // 2. Try series-level pipeline.yaml
    const seriesPipeline = path.join(root, channel, series, "pipeline.yaml");
    try {
      const raw = readFileSync(seriesPipeline, "utf-8");
      const doc = yaml.parse(raw) as Record<string, unknown> | null;
      if (doc?.pipeline) return String(doc.pipeline);
    } catch { /* no series pipeline */ }

    // 3. Try channel-level pipeline.yaml
    const chPipeline = path.join(root, channel, "pipeline.yaml");
    try {
      const raw = readFileSync(chPipeline, "utf-8");
      const doc = yaml.parse(raw) as Record<string, unknown> | null;
      if (doc?.pipeline) return String(doc.pipeline);
    } catch { /* no channel pipeline */ }

    return "narrated-illustrated-video"; // default fallback
  }

  private async countSeries(channelPath: string): Promise<any[]> {
    try {
      const entries = await fs.readdir(channelPath, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
    } catch { return []; }
  }

  private async countEpisodes(seriesPath: string): Promise<number> {
    try {
      const entries = await fs.readdir(seriesPath, { withFileTypes: true });
      return entries.filter(isEpisodeDirectory).length;
    } catch { return 0; }
  }

  private async detectStatus(epPath: string): Promise<string> {
    try {
      const qa = JSON.parse(await fs.readFile(path.join(epPath, "artifacts", "qa-report.json"), "utf-8")) as { approved?: unknown };
      if (qa.approved === true) return "completed";
    } catch { /* no approved QA report */ }

    try {
      const pointer = JSON.parse(await fs.readFile(path.join(epPath, "output", "current.json"), "utf-8")) as { path?: unknown };
      if (typeof pointer.path === "string" && !path.isAbsolute(pointer.path) && !pointer.path.includes("..")) {
        await fs.access(path.join(epPath, "output", pointer.path));
        return "in-progress";
      }
    } catch { /* no canonical render */ }

    try { await fs.access(path.join(epPath, "artifacts", "output.mp4")); return "completed"; } catch {}
    for (const marker of ["production-profile.json", "visual-beats.json", "script.md"]) {
      try { await fs.access(path.join(epPath, "artifacts", marker)); return "in-progress"; } catch {}
    }
    return "pending";
  }

  private titleFromSlug(slug: string): string {
    return slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async findEvents(
    ref: { channel: string; series: string; episode: string },
    _query: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const episodeDir = path.join(
      this.roots[0]!,
      ref.channel,
      ref.series,
      ref.episode,
    );
    const events: Array<Record<string, unknown>> = [];
    // Read review files
    const reviewsDir = path.join(episodeDir, "reviews");
    try {
      const files = await fs.readdir(reviewsDir);
      for (const f of files.slice(0, 50)) {
        if (f.endsWith(".json")) {
          const content = await fs.readFile(path.join(reviewsDir, f), "utf-8");
          events.push(JSON.parse(content));
        }
      }
    } catch { /* skip */ }
    return events;
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
  sceneId: string,
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

  // Heuristic: match captions to scene by checking if the text references
  // scene-related content or simply return all for now (SRT spans entire video)
  // For SRT files keyed to scene, return segments whose start time falls within
  // the scene's duration window.
  
  // For now, return segments proportioned to scene index
  if (segments.length === 0) return [];
  
  // Simple approach: if sceneId is like s1, s2 etc, estimate time window
  const sceneNum = parseInt(sceneId.replace(/^s/, ""), 10);
  if (isNaN(sceneNum) || segments.length < 8) {
    // Return all segments — whole-video SRT
    return segments.filter(s => s.index > 0).map(s => ({
      time: s.start,
      text: s.text,
    }));
  }

  // Distribute SRT segments across scenes by index proportion
  const perScene = Math.ceil(segments.length / 8); // assume 8 scenes
  const startIdx = (sceneNum - 1) * perScene;
  const endIdx = sceneNum * perScene;

  return segments.slice(startIdx, endIdx).map(s => ({
    time: s.start,
    text: s.text,
  }));
}
