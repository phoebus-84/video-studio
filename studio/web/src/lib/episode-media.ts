// An episode file as an object URL (avg-goz): fetched through the gateway's
// file route with the bearer header and wrapped in a blob, as files-store
// does, so the token never goes into a URL. Callers revoke what they get.

import { getGatewayClient } from "$lib/gateway.svelte.ts";
import { episodeApi, type EpisodeRef } from "$lib/sheet-review";

export async function episodeMediaUrl(ref: EpisodeRef, path: string): Promise<string | null> {
  const client = getGatewayClient();
  try {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${client.baseUrl}${episodeApi(ref)}/file/${encoded}`, {
      headers: { authorization: `Bearer ${client.token ?? ""}` },
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/** Where a file lives: an episode, or a channel source (library/<channel>/sources/<name>/), read through the channel's file route. */
export type MediaPlace = EpisodeRef | { channel: string; source: string };

export const isSourcePlace = (place: MediaPlace): place is { channel: string; source: string } => "source" in place;

/** A file of an episode or of a channel source, as an object URL. Callers revoke what they get. */
export async function mediaUrl(place: MediaPlace, path: string): Promise<string | null> {
  if (!isSourcePlace(place)) return episodeMediaUrl(place, path);
  const client = getGatewayClient();
  try {
    const encoded = ["sources", place.source, ...path.split("/")].map(encodeURIComponent).join("/");
    const res = await fetch(`${client.baseUrl}/api/channels/${encodeURIComponent(place.channel)}/file/${encoded}`, {
      headers: { authorization: `Bearer ${client.token ?? ""}` },
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}
