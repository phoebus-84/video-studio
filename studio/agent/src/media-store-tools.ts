// ---------------------------------------------------------------------------
// A channel's media between machines (ADR-0045)
// ---------------------------------------------------------------------------
// media.lock.jsonl names a channel's heavy media by sha256; the media store
// (an S3-compatible bucket set by AVG_MEDIA_STORE*, see docs/running.md)
// keeps their bytes under that hash. This tool is `vpr channel media` for
// the agent: what this machine lacks, fetched; what it made, sent.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { channelPath } from "@studio/contracts/src/layout.mjs";
import { checkMedia, MEDIA_LOCK, writeMediaLock } from "@studio/runtime/channel-repo";
import { connect, pullMedia, pushMedia, storeFromEnv, type MediaSync } from "@studio/runtime/media-store";

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

function summary(channel: string, verb: string, synced: MediaSync): string {
  const bytes = synced.moved.reduce((n, m) => n + m.size, 0);
  return [
    `${channel}: ${synced.moved.length} files (${mb(bytes)}) ${verb} ${synced.endpoint}, ${synced.present} already there`,
    ...synced.skipped.map((s) => `skipped ${s.path}: ${s.reason}`),
    ...synced.failed.map((f) => `❌ ${f.path}: ${f.error}`),
  ].join("\n");
}

export function registerMediaStoreTools(pi: ExtensionAPI): void {
  const LIBRARY_ROOT = process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");

  pi.registerTool({
    name: "pva_channel_media",
    label: "Channel Media",
    description:
      `A channel's heavy media against ${MEDIA_LOCK} and the shared media store. ` +
      "check: what this machine lacks, has changed, or has not named (reads only). " +
      `name: write this machine's media into ${MEDIA_LOCK}. ` +
      "pull: fetch from the store what the lock names and this machine lacks (a file here is never overwritten; a download is kept only with the named hash) — use it when a check, a render or a pin fails on missing media. " +
      `push: name this machine's media in ${MEDIA_LOCK}, then send the store what it lacks — after making media another machine will need. ` +
      `The lock then changed: commit it in the channel's repository with the work that made the media.`,
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      action: Type.Union([Type.Literal("check"), Type.Literal("name"), Type.Literal("pull"), Type.Literal("push")]),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const dir = channelPath(LIBRARY_ROOT, params.channel);
      if (!existsSync(dir)) throw new Error(`there is no channel "${params.channel}" in ${LIBRARY_ROOT}`);
      if (params.action === "check") {
        const checked = checkMedia(dir);
        const list = (what: string, keys: string[]) => (keys.length ? [`${what} (${keys.length}): ${keys.slice(0, 20).join(", ")}${keys.length > 20 ? ", …" : ""}`] : []);
        const text = checked.ok
          ? `${params.channel}: every media file is here and is the one ${MEDIA_LOCK} names`
          : [...list("missing — pull them", checked.missing), ...list("changed", checked.changed), ...list("not yet named — name or push them", checked.unlisted)].join("\n");
        return { content: [{ type: "text" as const, text }], details: checked as unknown as Record<string, unknown> };
      }
      if (params.action === "name" || params.action === "push") {
        const written = writeMediaLock(dir);
        if (params.action === "name") {
          return {
            content: [{ type: "text" as const, text: `${params.channel}: ${written.files} media files named in ${MEDIA_LOCK} (${mb(written.bytes)} here, ${written.absent} on other machines)` }],
            details: written as unknown as Record<string, unknown>,
          };
        }
      }
      if (signal?.aborted) throw new Error("cancelled");
      const store = await connect(storeFromEnv());
      let shown = -1;
      const onProgress = (done: number, total: number) => {
        const pct = Math.floor((done / total) * 100);
        if (pct < shown + 5 && done < total) return;
        shown = pct;
        onUpdate?.({ content: [{ type: "text" as const, text: `${params.action} ${done}/${total} (${pct}%)` }], details: { done, total } });
      };
      const synced = params.action === "pull"
        ? await pullMedia(dir, store, { onProgress })
        : await pushMedia(dir, store, { onProgress });
      const text = summary(params.channel, params.action === "pull" ? "fetched from" : "sent to", synced);
      if (synced.failed.length) throw new Error(text);
      return { content: [{ type: "text" as const, text }], details: synced as unknown as Record<string, unknown> };
    },
  });
}
