// ---------------------------------------------------------------------------
// Filesystem-backed workspace service
// ---------------------------------------------------------------------------
// Scans the library directory for channels, series, and episodes.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { WorkspaceService, ChannelSummary, SeriesSummary, EpisodeSummary } from "./service.js";

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
          if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

          const epPath = path.join(seriesPath, entry.name);

          episodes.push({
            slug: entry.name,
            title: this.titleFromSlug(entry.name),
            status: await this.detectStatus(epPath),
            pipeline: "narrated-illustrated-video",
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
        const base: EpisodeSummary = {
          slug: episode,
          title: this.titleFromSlug(episode),
          status,
          pipeline: "narrated-illustrated-video",
          updatedAt: new Date().toISOString(),
        };

        // Try to read episode.json for richer data
        try {
          const metaPath = path.join(epPath, "episode.json");
          const raw = await fs.readFile(metaPath, "utf-8");
          const meta = JSON.parse(raw);
          return { ...base, ...meta, slug: episode, status, updatedAt: new Date().toISOString() };
        } catch {
          return base;
        }
      } catch { /* not found */ }
    }
    return null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async countSeries(channelPath: string): Promise<any[]> {
    try {
      const entries = await fs.readdir(channelPath, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
    } catch { return []; }
  }

  private async countEpisodes(seriesPath: string): Promise<number> {
    try {
      const entries = await fs.readdir(seriesPath, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).length;
    } catch { return 0; }
  }

  private async detectStatus(epPath: string): Promise<string> {
    // Check for output render
    try { await fs.access(path.join(epPath, "artifacts", "output.mp4")); return "completed"; } catch {}
    // Check for script
    try { await fs.access(path.join(epPath, "artifacts", "script.md")); return "in-progress"; } catch {}
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
