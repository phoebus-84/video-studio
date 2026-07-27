import type {
  HealthReport,
  ErrorResponse,
  ChannelSummary,
  SeriesSummary,
  EpisodeSummary,
  EpisodeDetail,
  ConnectionState,
  WsEvent,
} from "$contracts/gateway";

/**
 * Typed HTTP and event client for the Video Studio Gateway.
 *
 * Uses bearer token authentication. The token is read from an injectable
 * source so tests can substitute fixture tokens without reaching the OS.
 */
export interface GatewayClientOptions {
  baseUrl: string;
  tokenProvider: () => string | null;
  fetch?: typeof fetch;
}

export class GatewayClient {
  readonly #baseUrl: string;
  readonly #tokenProvider: () => string | null;
  readonly #fetch: typeof fetch;

  constructor(options: GatewayClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#tokenProvider = options.tokenProvider;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /* ── health ── */
  async health(): Promise<HealthReport> {
    return this.#get("/health", { authenticated: false });
  }

  /* ── workspace discovery ── */
  async listChannels(): Promise<ChannelSummary[]> {
    return this.#get("/api/channels");
  }

  async listSeries(channel: string): Promise<SeriesSummary[]> {
    return this.#get(`/api/channels/${encodeURIComponent(channel)}/series`);
  }

  async listEpisodes(
    channel: string,
    series: string,
  ): Promise<EpisodeSummary[]> {
    return this.#get(
      `/api/channels/${encodeURIComponent(channel)}/series/${encodeURIComponent(series)}/episodes`,
    );
  }

  async getEpisode(
    channel: string,
    series: string,
    episode: string,
  ): Promise<EpisodeDetail> {
    return this.#get(
      `/api/channels/${encodeURIComponent(channel)}/series/${encodeURIComponent(series)}/episodes/${encodeURIComponent(episode)}`,
    );
  }

  /* ── connection ── */
  async connection(): Promise<ConnectionState> {
    return this.#get("/api/connection");
  }

  /* ── events ── */
  connectEventSource(
    episode?: string,
  ): { eventSource: EventSource; close: () => void } {
    const token = this.#tokenProvider();
    const url = new URL("/events", this.#baseUrl);
    if (episode) {
      url.searchParams.set("episode", episode);
    }
    url.searchParams.set("token", token ?? "");

    const es = new EventSource(url.toString());
    return {
      eventSource: es,
      close: () => es.close(),
    };
  }

  /* ── internal ── */

  async #get<T>(
    path: string,
    options?: { authenticated?: boolean },
  ): Promise<T> {
    const { authenticated = true } = options ?? {};
    const headers: Record<string, string> = { Accept: "application/json" };

    if (authenticated) {
      const token = this.#tokenProvider();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const err = body as ErrorResponse;
      throw new GatewayClientError(
        response.status,
        err.error ?? "unknown",
        err.message ?? response.statusText,
        err.correlationId ?? "",
      );
    }

    return response.json() as Promise<T>;
  }
}

export class GatewayClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string;

  constructor(status: number, code: string, message: string, correlationId: string) {
    super(message);
    this.name = "GatewayClientError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

/**
 * Parse a gateway SSE data line into a typed WsEvent.
 * Returns null for heartbeat or unparsable payloads.
 */
export function parseWsEvent(data: string): WsEvent | null {
  try {
    const raw = JSON.parse(data) as Record<string, unknown>;
    if (
      typeof raw.type !== "string" ||
      typeof raw.sequence !== "number" ||
      typeof raw.timestamp !== "string" ||
      typeof raw.episode !== "string"
    ) {
      return null;
    }
    return {
      type: raw.type as WsEvent["type"],
      sequence: raw.sequence,
      timestamp: raw.timestamp,
      episode: raw.episode,
      payload: (raw.payload as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}
