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
