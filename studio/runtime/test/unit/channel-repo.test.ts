import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMedia, initChannelRepo, MEDIA_LOCK, writeMediaLock } from "../../src/channel-repo.js";

/**
 * A channel as its own git repository (avg-d1x phase 5): its code, releases
 * and data in git; its heavy media out of it, each named in media.lock.json
 * by its hash and size, so a collaborator knows what to fetch.
 */

let root: string;
const channel = () => join(root, "sample");
const sha = (bytes: string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const put = (relative: string, content: string) => {
  mkdirSync(join(channel(), relative, ".."), { recursive: true });
  writeFileSync(join(channel(), relative), content);
};
const git = (...args: string[]) => execFileSync("git", ["-C", channel(), ...args], { encoding: "utf-8" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "channel-repo-"));
  put("channel.json", '{"id":"sample"}\n');
  put("series/poetry/episodes/morning/episode-spec.json", "{}\n");
  put("series/poetry/episodes/morning/assets/images/sea.png", "a sea");
  put("series/poetry/episodes/morning/assets/takes/recital.wav", "a voice");
  put("series/poetry/episodes/morning/output/render-1.mp4", "a video");
  put("series/poetry/episodes/morning/.cache/remotion/segment.mp4", "a cached segment");
  put("series/poetry/episodes/morning/artifacts/edit-timeline.1a2b3c4d.bak.json", "{}\n");
  put("series/poetry/episodes/morning/journal/events.jsonl", '{"type":"stage-leased"}\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("initChannelRepo", () => {
  it("makes the channel a repository that keeps its text and leaves its media, caches and backups out", () => {
    const made = initChannelRepo(channel(), { commit: true, author: { name: "Test", email: "test@example.invalid" } });
    expect(made.created).toEqual([".gitignore", ".gitattributes", MEDIA_LOCK]);
    expect(existsSync(join(channel(), ".git"))).toBe(true);
    const tracked = git("ls-files").trim().split("\n").sort();
    expect(tracked).toEqual([".gitattributes", ".gitignore", "channel.json", MEDIA_LOCK, "series/poetry/episodes/morning/episode-spec.json", "series/poetry/episodes/morning/journal/events.jsonl"]);
    expect(git("log", "--format=%s").trim()).toBe("The sample channel as a repository: its media named in media.lock.json");
    // Two people appending to one stage journal merge by union, never by hand.
    expect(readFileSync(join(channel(), ".gitattributes"), "utf-8")).toContain("**/journal/*.jsonl merge=union");
  });

  it("names every heavy file by hash and size, but no cache", () => {
    initChannelRepo(channel());
    const lock = JSON.parse(readFileSync(join(channel(), MEDIA_LOCK), "utf-8"));
    expect(lock).toEqual({
      apiVersion: "studio.video/v1alpha1",
      kind: "MediaLock",
      files: {
        "series/poetry/episodes/morning/assets/images/sea.png": { hash: sha("a sea"), size: 5 },
        "series/poetry/episodes/morning/assets/takes/recital.wav": { hash: sha("a voice"), size: 7 },
        "series/poetry/episodes/morning/output/render-1.mp4": { hash: sha("a video"), size: 7 },
      },
    });
  });

  it("keeps a repository and a .gitignore it finds, adding only what is missing", () => {
    execFileSync("git", ["init", "-q", channel()]);
    put(".gitignore", "my-notes/\n");
    const made = initChannelRepo(channel());
    expect(made.created).toEqual([".gitattributes", MEDIA_LOCK]);
    expect(made.kept).toEqual([".git", ".gitignore"]);
    expect(readFileSync(join(channel(), ".gitignore"), "utf-8")).toBe("my-notes/\n");
  });
});

describe("checkMedia", () => {
  it("says what a collaborator lacks after a pull, what changed, and what the lock does not name yet", () => {
    initChannelRepo(channel());
    rmSync(join(channel(), "series/poetry/episodes/morning/assets/takes/recital.wav"));
    put("series/poetry/episodes/morning/assets/images/sea.png", "a stormier sea");
    put("series/poetry/episodes/morning/assets/images/sky.png", "a sky");
    expect(checkMedia(channel())).toEqual({
      ok: false,
      missing: ["series/poetry/episodes/morning/assets/takes/recital.wav"],
      changed: ["series/poetry/episodes/morning/assets/images/sea.png"],
      unlisted: ["series/poetry/episodes/morning/assets/images/sky.png"],
    });
    writeMediaLock(channel());
    expect(checkMedia(channel())).toEqual({ ok: true, missing: [], changed: [], unlisted: [] });
  });

  it("is ok with media the lock names and nothing more, and refuses a channel with no lock", () => {
    initChannelRepo(channel());
    expect(checkMedia(channel()).ok).toBe(true);
    rmSync(join(channel(), MEDIA_LOCK));
    expect(() => checkMedia(channel())).toThrow(/vpr channel media/);
  });
});
