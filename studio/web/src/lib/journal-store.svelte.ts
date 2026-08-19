/**
 * The episode journal — what actually happened, in order.
 *
 * The gateway returns loosely-typed event records read off disk, so everything
 * here is defensive: an event missing a timestamp or a message is shown as the
 * partial record it is rather than dropped, because a journal that silently
 * omits malformed entries is worse than one that shows them plainly.
 */

import { getGatewayClient } from "./gateway.svelte.ts";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface JournalEntry {
  id: string;
  /** Local time-of-day, or null when the record carries no usable timestamp. */
  time: string | null;
  level: LogLevel;
  message: string;
}

/** Events whose type or payload reads as a failure are shown as such. */
function levelOf(record: Record<string, unknown>): LogLevel {
  const explicit = String(record["level"] ?? "").toUpperCase();
  if (explicit === "WARN" || explicit === "WARNING") return "WARN";
  if (explicit === "ERROR" || explicit === "FATAL") return "ERROR";

  const type = String(record["type"] ?? "").toLowerCase();
  if (type.includes("fail") || type.includes("error") || type.includes("blocked")) {
    return "ERROR";
  }
  if (type.includes("warn") || type.includes("reject") || type.includes("stale")) {
    return "WARN";
  }
  return "INFO";
}

function messageOf(record: Record<string, unknown>): string {
  const data = record["data"];
  const fromData =
    data && typeof data === "object"
      ? ((data as Record<string, unknown>)["message"] ??
         (data as Record<string, unknown>)["reason"])
      : undefined;

  const message = record["message"] ?? fromData;
  if (typeof message === "string" && message.trim()) return message;

  const type = record["type"];
  if (typeof type === "string" && type.trim()) return type;

  /* Nothing readable — show the record rather than an empty row. */
  return JSON.stringify(record);
}

function timeOf(record: Record<string, unknown>): string | null {
  const raw = record["timestamp"] ?? record["createdAt"] ?? record["at"];
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function normalise(records: Array<Record<string, unknown>>): JournalEntry[] {
  return records.map((record, i) => ({
    id: String(record["id"] ?? i),
    time: timeOf(record),
    level: levelOf(record),
    message: messageOf(record),
  }));
}

class JournalStore {
  entries = $state<JournalEntry[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  /** The episode key the current entries belong to. */
  loadedFor = $state<string | null>(null);

  async load(episodeKey: string): Promise<void> {
    const [channel, series, episode] = episodeKey.split("/");
    if (!channel || !series || !episode) return;

    this.loading = true;
    this.error = null;
    try {
      const data = await getGatewayClient().fetchJSON<{
        events?: Array<Record<string, unknown>>;
      }>(
        `/api/channels/${encodeURIComponent(channel)}/series/${encodeURIComponent(series)}` +
          `/episodes/${encodeURIComponent(episode)}/journal?limit=100`,
      );
      this.entries = normalise(data.events ?? []);
      this.loadedFor = episodeKey;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.entries = [];
    } finally {
      this.loading = false;
    }
  }

  clear(): void {
    this.entries = [];
    this.loadedFor = null;
    this.error = null;
  }
}

export const journal = new JournalStore();
