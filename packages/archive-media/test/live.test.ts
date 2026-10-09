// Opt-in: AVG_LIVE_ARCHIVE=1 npx vitest run test/live.test.ts
// Each provider is searched for real and one allowed original is fetched:
// provider APIs change (the Met retired its v1 search on 2026-10-01).

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArchive } from "../src/archive.js";
import type { MediaType } from "../src/types.js";

const live = process.env.AVG_LIVE_ARCHIVE === "1";
const dir = mkdtempSync(join(tmpdir(), "archive-live-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const archive = createArchive({ userAgent: "video-studio-archive-media/0.1 (https://github.com/phoebus-84/video-studio)" });

const CASES: [string, string, MediaType][] = [
  ["aic", "storm", "image"],
  ["met", "storm", "image"],
  ["cleveland", "storm", "image"],
  ["commons", "storm painting", "image"],
  ["commons", "thunder", "audio"],
  ["nasa", "lightning", "image"],
  ["openverse", "thunderstorm", "image"],
  ["internet-archive", "thunderstorm", "video"],
  ...(process.env.FREESOUND_API_KEY ? [["freesound", "wind leaves", "audio"] as [string, string, MediaType]] : []),
];

describe.skipIf(!live)("live providers", { timeout: 180_000 }, () => {
  it.each(CASES)("%s finds %s (%s) and fetches an allowed original", async (provider, query, mediaType) => {
    const found = await archive.search(query, { mediaType, providers: [provider], limit: 10, quality: { minImageLongSide: 1000, minVideoHeight: 360 } });
    expect(found.errors).toEqual([]);
    expect(found.candidates.length).toBeGreaterThan(0);
    // Search results may lack size or file (the Internet Archive's): try the allowed ones until one fetches.
    const errors: string[] = [];
    for (const candidate of found.candidates.filter((c) => c.allowed).slice(0, 4)) {
      try {
        const got = await archive.fetch(provider, candidate.id, { dir, name: `${provider}-${mediaType}`, quality: { minImageLongSide: 1000, minVideoHeight: 360 }, maxBytes: 300 * 1024 ** 2 });
        expect(got.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(got.item.licence.id).not.toBe("unknown");
        console.log(`${provider}: ${got.item.title} — ${got.item.licence.id} — ${got.width ?? "?"}×${got.height ?? "?"} — ${(got.bytes / 1e6).toFixed(1)} MB`);
        return;
      } catch (error) {
        errors.push(`${candidate.id}: ${(error as Error).message}`);
      }
    }
    throw new Error(`nothing fetched: ${errors.join(" | ") || "no allowed candidate"}`);
  });
});
