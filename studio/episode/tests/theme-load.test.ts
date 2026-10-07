import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadEpisode, sharedRootsOf } from "../src/series-compile.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * The channel theme a series template release pins (avg-dcf.4.1, ADR-0040):
 * read from library/<channel>/themes/<id>/<version>/, checked against the
 * pin's hash and the contract, its room images offered as theme-<room>.
 */

const require = createRequire(import.meta.url);
const SAMPLE = dirname(require.resolve("@studio/contracts/fixtures/channel-theme/sample/themes/sample/1.0.0/theme.json"));
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const channel = () => join(root, REF.channel);
const themeDir = () => join(channel(), "themes", "sample", "1.0.0");
const release = () => join(channel(), "series", REF.series, "templates", "poetry-short", "1.0.0");

/** Pin `hash` (default: the theme's own) in the release, and the release in the spec. */
function pinTheme(hash?: string) {
  const manifestPath = join(release(), "series-template.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.theme = { id: "sample", version: "1.0.0", hash: hash ?? sha256(readFileSync(join(themeDir(), "theme.json"))) };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, text);
  const specPath = join(dir(), "episode-spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf-8"));
  spec.template.hash = sha256(text);
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
}
const problemsOf = () => {
  const loaded = loadEpisode(dir(), { episodeRef: REF });
  expect(loaded.ok).toBe(false);
  return loaded.ok ? [] : loaded.problems.map((p) => [p.code, p.path]);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "theme-load-"));
  specEpisode(dir(), REF);
  cpSync(SAMPLE, themeDir(), { recursive: true });
  mkdirSync(join(themeDir(), "rooms"), { recursive: true });
  writeFileSync(join(themeDir(), "rooms", "hall.png"), "a hall");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("loadEpisode with a pinned theme", () => {
  it("gives the compiler the theme, its room images as assets, everything hashed", () => {
    pinTheme();
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.input.theme).toEqual(JSON.parse(readFileSync(join(themeDir(), "theme.json"), "utf-8")));
    const image = "../../../../themes/sample/1.0.0/rooms/hall.png";
    expect(loaded.input.assets["theme-hall"]).toEqual({ path: image, hash: sha256("a hall"), kind: "image" });
    expect(loaded.input.inputs[image]).toBe(sha256("a hall"));
    expect(loaded.input.inputs["../../../../themes/sample/1.0.0/theme.json"]).toBe(sha256(readFileSync(join(themeDir(), "theme.json"))));
  });

  it("offers a room's monitor clip as theme-<room>-monitor", () => {
    const theme = JSON.parse(readFileSync(join(themeDir(), "theme.json"), "utf-8"));
    theme.rooms.hall.monitor = { box: { x: 1316, y: 541, w: 154, h: 111 }, video: "rooms/monitor.mp4" };
    writeFileSync(join(themeDir(), "theme.json"), JSON.stringify(theme));
    writeFileSync(join(themeDir(), "rooms", "monitor.mp4"), "a clip");
    pinTheme();
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.input.assets["theme-hall-monitor"]).toEqual({ path: "../../../../themes/sample/1.0.0/rooms/monitor.mp4", hash: sha256("a clip"), kind: "video" });
  });

  it("leaves an episode whose release pins no theme as it was", () => {
    const loaded = loadEpisode(dir(), { episodeRef: REF });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems));
    expect(loaded.input.theme).toBeUndefined();
    expect(Object.keys(loaded.input.assets).some((id) => id.startsWith("theme-"))).toBe(false);
  });

  it("missing-theme: the pinned release is not in the channel", () => {
    pinTheme(`sha256:${"a".repeat(64)}`);
    rmSync(themeDir(), { recursive: true });
    expect(problemsOf()).toEqual([["missing-theme", "../../templates/poetry-short/1.0.0/series-template.json#$.theme"]]);
  });

  it("theme-mismatch: theme.json changed after the release pinned it", () => {
    pinTheme();
    const theme = JSON.parse(readFileSync(join(themeDir(), "theme.json"), "utf-8"));
    theme.look.colors.accent = "#ff0000";
    writeFileSync(join(themeDir(), "theme.json"), JSON.stringify(theme));
    expect(problemsOf()).toEqual([["theme-mismatch", "../../../../themes/sample/1.0.0/theme.json"]]);
  });

  it("refuses a theme the contract refuses, at its path inside theme.json", () => {
    const theme = JSON.parse(readFileSync(join(themeDir(), "theme.json"), "utf-8"));
    theme.look.fonts.serif = "Garamond";
    writeFileSync(join(themeDir(), "theme.json"), JSON.stringify(theme));
    pinTheme();
    expect(problemsOf()).toEqual([["unknown-font", "../../../../themes/sample/1.0.0/theme.json#$.look.fonts.serif"]]);
  });

  it("path-escape: a room image that is a link out of the channel's themes", () => {
    const outside = join(root, "elsewhere.png");
    writeFileSync(outside, "not this theme's");
    unlinkSync(join(themeDir(), "rooms", "hall.png"));
    symlinkSync(outside, join(themeDir(), "rooms", "hall.png"));
    pinTheme();
    expect(problemsOf()).toEqual([["path-escape", "../../../../themes/sample/1.0.0/rooms/hall.png"]]);
  });

  it("path-escape: a room image that is a link into another release of the channel's themes", () => {
    const other = join(channel(), "themes", "sample", "0.9.0", "rooms");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "hall.png"), "an older hall");
    unlinkSync(join(themeDir(), "rooms", "hall.png"));
    symlinkSync(join(other, "hall.png"), join(themeDir(), "rooms", "hall.png"));
    pinTheme();
    expect(problemsOf()).toEqual([["path-escape", "../../../../themes/sample/1.0.0/rooms/hall.png"]]);
  });

  it("theme-mismatch: a theme.json whose id or version is not the release it sits in", () => {
    const theme = JSON.parse(readFileSync(join(themeDir(), "theme.json"), "utf-8"));
    theme.version = "1.0.1";
    writeFileSync(join(themeDir(), "theme.json"), JSON.stringify(theme));
    pinTheme();
    expect(problemsOf()).toEqual([["theme-mismatch", "../../../../themes/sample/1.0.0/theme.json#$.version"]]);
  });

  it("missing-asset: a room image the theme names is not there", () => {
    unlinkSync(join(themeDir(), "rooms", "hall.png"));
    pinTheme();
    expect(problemsOf()).toEqual([["missing-asset", "../../../../themes/sample/1.0.0/rooms/hall.png"]]);
  });
});

describe("sharedRootsOf", () => {
  it("lets a render take assets from the theme release the episode's release pins, and from nowhere else", () => {
    // no theme pinned: nothing outside the episode
    expect(sharedRootsOf(dir())).toEqual([]);
    pinTheme();
    expect(sharedRootsOf(dir())).toEqual([themeDir()]);
  });
});

