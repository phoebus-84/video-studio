import { expect, test, describe } from "vitest";
import {
  libraryUrlPath,
  librarySegments,
} from "@studio/contracts/src/library-url.mjs";
import { episodePath, seriesPath, channelPath } from "@studio/contracts/src/layout.mjs";

/**
 * The URL the studio asks for must address the same place the gateway stores.
 *
 * These are two different code paths — one joins with `/` for a URL, the other
 * with the platform separator for disk — and they only stay in step because
 * they share the container names. The layout check below is the one that would
 * actually catch a drift, since a mismatch shows up in the browser as a 404 on
 * every asset, which reads as "missing file" rather than "wrong path".
 */
describe("library URL paths", () => {
  test("channel level", () => {
    expect(libraryUrlPath({ channel: "acme" }, "brand.md")).toBe(
      "/library/acme/brand.md",
    );
  });

  test("series level nests under the series container", () => {
    expect(libraryUrlPath({ channel: "acme", series: "s1" }, "pipeline.yaml")).toBe(
      "/library/acme/series/s1/pipeline.yaml",
    );
  });

  test("episode level nests under both containers", () => {
    expect(
      libraryUrlPath(
        { channel: "acme", series: "s1", episode: "ep-01" },
        "artifacts/final.mp4",
      ),
    ).toBe("/library/acme/series/s1/episodes/ep-01/artifacts/final.mp4");
  });

  test("agrees with the on-disk layout", () => {
    /* Same reference, both builders, one root — the segments must match. */
    const ref = { channel: "acme", series: "s1", episode: "ep-01" };
    const disk = episodePath("/root", ref.channel, ref.series, ref.episode);
    const url = libraryUrlPath(ref, "");

    expect(url).toBe("/library" + disk.slice("/root".length));
    expect(libraryUrlPath({ channel: "acme", series: "s1" }, "")).toBe(
      "/library" + seriesPath("/root", "acme", "s1").slice("/root".length),
    );
    expect(libraryUrlPath({ channel: "acme" }, "")).toBe(
      "/library" + channelPath("/root", "acme").slice("/root".length),
    );
  });
});

describe("encoding and safety", () => {
  test("encodes each segment but keeps separators", () => {
    expect(
      libraryUrlPath({ channel: "my channel" }, "a folder/a file #2.png"),
    ).toBe("/library/my%20channel/a%20folder/a%20file%20%232.png");
  });

  test("refuses paths that climb out of the level", () => {
    /* The static route would reject it, but returning null lets the caller say
       "no preview" instead of firing a request that cannot succeed. */
    expect(libraryUrlPath({ channel: "acme" }, "../other/secret")).toBeNull();
    expect(
      libraryUrlPath({ channel: "acme", series: "s1" }, "a/../../b"),
    ).toBeNull();
  });

  test("tolerates redundant separators and dot segments", () => {
    expect(libraryUrlPath({ channel: "acme" }, "/a//./b.md")).toBe(
      "/library/acme/a/b.md",
    );
  });

  test("returns null without a channel to anchor to", () => {
    expect(libraryUrlPath({}, "x.png")).toBeNull();
  });

  test("an empty relative path addresses the level itself", () => {
    expect(libraryUrlPath({ channel: "acme" }, "")).toBe("/library/acme");
  });
});

describe("segments", () => {
  test("a series without a channel yields nothing", () => {
    expect(librarySegments({ series: "s1" })).toEqual([]);
  });

  test("an episode without a series stops at the channel", () => {
    /* An episode is addressed through its series; without one there is no
       path to it, so inventing one would produce a confident 404. */
    expect(librarySegments({ channel: "acme", episode: "ep-01" })).toEqual([
      "acme",
    ]);
  });
});
