import type {
  ChannelSummary,
  SeriesSummary,
  EpisodeSummary,
  EpisodeDetail,
} from "../contracts/types";

/** Gateway error with structured fields. */
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export const workspaceNotFound = (detail: string) =>
  new WorkspaceError(detail, "WORKSPACE_NOT_FOUND", 404);

export const episodeNotFound = (slug: string) =>
  new WorkspaceError(`Episode not found: ${slug}`, "EPISODE_NOT_FOUND", 404);

export const channelNotFound = (slug: string) =>
  new WorkspaceError(`Channel not found: ${slug}`, "CHANNEL_NOT_FOUND", 404);

/**
 * Injectable workspace service. Tests use fixture implementations;
 * production reads from the filesystem via the pipeline runtime.
 */
export interface WorkspaceService {
  listChannels(): Promise<ChannelSummary[]>;
  listSeries(channelSlug: string): Promise<SeriesSummary[]>;
  listEpisodes(
    channelSlug: string,
    seriesSlug: string,
  ): Promise<EpisodeSummary[]>;
  getEpisode(
    channelSlug: string,
    seriesSlug: string,
    episodeSlug: string,
  ): Promise<EpisodeDetail>;
  findEvents(
    ref: { channel: string; series: string; episode: string },
    query: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>>;
}
