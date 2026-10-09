import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMedia, initChannelRepo, MEDIA_LOCK, readMediaLock, writeMediaLock } from "../../src/channel-repo.js";

/**
 * A channel as its own git repository (avg-d1x phase 5): its code, releases
 * and data in git; its heavy media out of it, each named in media.lock.jsonl
 * by its hash and size, so a collaborator knows what to fetch.
 */

let root: string;
const channel = () => join(root, "sample");
const sha = (bytes: string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const put = (relative: string, content: string) => {
  mkdirSync(join(channel(), relative, ".."), { recursive: true });
  writeFileSync(join(channel(), relative), content);
};
const git = (...args: string[]) => execFileSync("git", ["-C", channel(), "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { encoding: "utf-8" });
const AUTHOR = { name: "Test", email: "test@example.invalid" };
const EP = "series/poetry/episodes/morning";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "channel-repo-"));
  put("channel.json", '{"id":"sample"}\n');
  put(`${EP}/episode-spec.json`, "{}\n");
  put(`${EP}/assets/images/sea.png`, "a sea");
  put(`${EP}/assets/takes/recital.wav`, "a voice");
  put(`${EP}/output/render-1.mp4`, "a video");
  put(`${EP}/.cache/remotion/segment.mp4`, "a cached segment");
  put(`${EP}/artifacts/edit-timeline.1a2b3c4d.bak.json`, "{}\n");
  put(`${EP}/journal/events.jsonl`, '{"type":"stage-leased"}\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("initChannelRepo", () => {
  it("makes the channel a repository that keeps its text and leaves its media, caches and backups out", () => {
    const made = initChannelRepo(channel(), { commit: true, author: AUTHOR });
    expect(made.created).toEqual([".gitignore", ".gitattributes", MEDIA_LOCK]);
    expect(existsSync(join(channel(), ".git"))).toBe(true);
    expect(git("ls-files").trim().split("\n").sort()).toEqual([".gitattributes", ".gitignore", "channel.json", MEDIA_LOCK, `${EP}/episode-spec.json`, `${EP}/journal/events.jsonl`]);
    expect(git("log", "--format=%s").trim()).toBe("The sample channel as a repository: its media named in media.lock.jsonl");
    const attributes = readFileSync(join(channel(), ".gitattributes"), "utf-8");
    // Two people appending to one stage journal, or naming new media, merge by union, never by hand.
    expect(attributes).toContain("**/journal/*.jsonl merge=union");
    expect(attributes).toContain("media.lock.jsonl merge=union");
  });

  it("names every heavy file by hash and size, one line each, but no cache", () => {
    initChannelRepo(channel());
    const lines = readFileSync(join(channel(), MEDIA_LOCK), "utf-8").trim().split("\n");
    expect(JSON.parse(lines[0]!)).toEqual({ apiVersion: "studio.video/v1alpha1", kind: "MediaLock" });
    expect(lines.slice(1).map((l) => JSON.parse(l))).toEqual([
      { path: `${EP}/assets/images/sea.png`, hash: sha("a sea"), size: 5 },
      { path: `${EP}/assets/takes/recital.wav`, hash: sha("a voice"), size: 7 },
      { path: `${EP}/output/render-1.mp4`, hash: sha("a video"), size: 7 },
    ]);
  });

  it("ignores media whatever the case of its extension", () => {
    put(`${EP}/assets/images/SKY.PNG`, "a sky");
    initChannelRepo(channel(), { commit: true, author: AUTHOR });
    expect(git("ls-files")).not.toContain("SKY.PNG");
    expect(readMediaLock(channel()).get(`${EP}/assets/images/SKY.PNG`)).toEqual([{ hash: sha("a sky"), size: 5 }]);
  });

  it("names a symlinked media file as a link, never loses it", () => {
    symlinkSync("render-1.mp4", join(channel(), EP, "output", "final.mp4"));
    initChannelRepo(channel());
    expect(readMediaLock(channel()).get(`${EP}/output/final.mp4`)).toEqual([{ link: "render-1.mp4" }]);
    expect(checkMedia(channel()).ok).toBe(true);
  });

  it("keeps a repository and a .gitignore it finds, warns of media they would commit, and commits only its own files", () => {
    git("init", "-q");
    put(".gitignore", "my-notes/\n");
    put("draft.md", "work in progress");
    const made = initChannelRepo(channel(), { commit: true, author: AUTHOR });
    expect(made.created).toEqual([".gitattributes", MEDIA_LOCK]);
    expect(made.kept).toEqual([".git", ".gitignore"]);
    expect(made.notIgnored).toEqual([`${EP}/assets/images/sea.png`, `${EP}/assets/takes/recital.wav`, `${EP}/output/render-1.mp4`]);
    expect(readFileSync(join(channel(), ".gitignore"), "utf-8")).toBe("my-notes/\n");
    // Its own three files, never the person's other work.
    expect(git("show", "--name-only", "--format=").trim().split("\n").sort()).toEqual([".gitattributes", MEDIA_LOCK]);
  });

  it("commits nothing, and says so, when there is nothing new", () => {
    initChannelRepo(channel(), { commit: true, author: AUTHOR });
    const again = initChannelRepo(channel(), { commit: true, author: AUTHOR });
    expect(again.commit).toBeNull();
    expect(git("rev-list", "--count", "HEAD").trim()).toBe("1");
  });
});

describe("the media lock between people", () => {
  it("keeps naming a file this machine has not fetched; only --prune forgets one", () => {
    initChannelRepo(channel());
    // A collaborator's lock names a picture this machine never had.
    writeFileSync(join(channel(), MEDIA_LOCK), readFileSync(join(channel(), MEDIA_LOCK), "utf-8") + `${JSON.stringify({ path: `${EP}/assets/images/far.png`, hash: sha("far"), size: 3 })}\n`);
    writeMediaLock(channel());
    expect(readMediaLock(channel()).has(`${EP}/assets/images/far.png`)).toBe(true);
    expect(checkMedia(channel()).missing).toEqual([`${EP}/assets/images/far.png`]);
    writeMediaLock(channel(), { prune: true });
    expect(readMediaLock(channel()).has(`${EP}/assets/images/far.png`)).toBe(false);
  });

  it("takes either side of a union merge that named one file twice, and settles it on the next write", () => {
    initChannelRepo(channel());
    const lock = readFileSync(join(channel(), MEDIA_LOCK), "utf-8");
    writeFileSync(join(channel(), MEDIA_LOCK), lock + `${JSON.stringify({ path: `${EP}/assets/images/sea.png`, hash: sha("another sea"), size: 11 })}\n`);
    expect(readMediaLock(channel()).get(`${EP}/assets/images/sea.png`)).toHaveLength(2);
    expect(checkMedia(channel()).ok).toBe(true);
    writeMediaLock(channel());
    expect(readMediaLock(channel()).get(`${EP}/assets/images/sea.png`)).toEqual([{ hash: sha("a sea"), size: 5 }]);
  });
});

describe("checkMedia", () => {
  it("says what a collaborator lacks after a pull, what changed, and what the lock does not name yet", () => {
    initChannelRepo(channel());
    rmSync(join(channel(), EP, "assets/takes/recital.wav"));
    put(`${EP}/assets/images/sea.png`, "a stormier sea");
    put(`${EP}/assets/images/sky.png`, "a sky");
    expect(checkMedia(channel())).toEqual({
      ok: false,
      missing: [`${EP}/assets/takes/recital.wav`],
      changed: [`${EP}/assets/images/sea.png`],
      unlisted: [`${EP}/assets/images/sky.png`],
    });
    writeMediaLock(channel(), { prune: true });
    expect(checkMedia(channel())).toEqual({ ok: true, missing: [], changed: [], unlisted: [] });
  });

  it("refuses a channel with no lock", () => {
    initChannelRepo(channel());
    rmSync(join(channel(), MEDIA_LOCK));
    expect(() => checkMedia(channel())).toThrow(/vpr channel media/);
  });
});
