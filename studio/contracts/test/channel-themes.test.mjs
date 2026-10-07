import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BUNDLED_FONTS, validateChannelTheme } from "../src/channel-themes.mjs";
import { validateSeriesTemplate } from "../src/series-templates.mjs";

const release = fileURLToPath(new URL("../fixtures/channel-theme/sample/themes/sample/1.0.0/", import.meta.url));
const theme = () => JSON.parse(readFileSync(path.join(release, "theme.json"), "utf8"));
const codes = (doc) => validateChannelTheme(doc).map((p) => [p.code, p.path]);

describe("validateChannelTheme (ADR-0040)", () => {
  it("accepts a complete theme", () => {
    assert.deepEqual(validateChannelTheme(theme()), []);
  });

  it("names the bundled font families the composer draws with", () => {
    assert.deepEqual(Object.keys(BUNDLED_FONTS).sort(), ["Anton", "Fraunces", "Inter"]);
  });

  it("refuses a font the composer does not bundle", () => {
    const doc = theme();
    doc.look.fonts.serif = "Garamond";
    assert.deepEqual(codes(doc), [["unknown-font", "$.look.fonts.serif"]]);
  });

  it("refuses a colour role missing or malformed, at its path", () => {
    const doc = theme();
    delete doc.look.colors.highlight;
    doc.look.colors.accent = "cyan";
    assert.deepEqual(codes(doc).map(([c]) => c), ["schema", "schema"]);
    assert.ok(codes(doc).some(([, p]) => p === '$["look"]["colors"]["accent"]'));
  });

  it("refuses a palette colour the puppet does not have, and a pose angle it does not have", () => {
    const doc = theme();
    doc.characters.guide.palette.cape = "#ff0000";
    doc.characters.guide.poses.indica.wave = 3;
    assert.deepEqual(codes(doc).map(([c]) => c), ["schema", "schema"]);
  });

  it("refuses a role whose family lacks the faces the kits draw it with", () => {
    const doc = theme();
    doc.look.fonts.serif = "Anton";
    doc.look.fonts.sans = "Fraunces";
    assert.deepEqual(codes(doc), [
      ["missing-face", "$.look.fonts.serif"],
      ["missing-face", "$.look.fonts.sans"],
    ]);
  });

  it("refuses a room whose name cannot name an asset, and a storm faster than a bolt lasts", () => {
    const doc = theme();
    doc.rooms["sala grande"] = doc.rooms.hall;
    assert.deepEqual([...new Set(codes(doc).map(([c]) => c))], ["schema"]);
    const fast = theme();
    fast.rooms.hall.sky[0].period = 1;
    assert.deepEqual(codes(fast).map(([c]) => c), ["schema"]);
  });

  it("refuses room geometry off the 1920×1080 frame", () => {
    const doc = theme();
    doc.rooms.hall.sky[0].poly[1] = [2200, 262];
    doc.rooms.hall.doors = [{ x: 1800, y: 300, w: 200, h: 400 }];
    assert.deepEqual(codes(doc), [
      ["off-frame", "$.rooms.hall.sky[0].poly[1]"],
      ["off-frame", "$.rooms.hall.doors[0]"],
    ]);
  });

  it("refuses an image path that climbs out of the release", () => {
    const doc = theme();
    doc.rooms.hall.image = "../other/hall.png";
    assert.deepEqual(codes(doc).map(([c]) => c), ["schema"]);
  });
});

describe("SeriesTemplate pins a theme", () => {
  const template = () => JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json", import.meta.url)), "utf8"));

  it("accepts a release with or without a theme pin", () => {
    assert.deepEqual(validateSeriesTemplate(template()), []);
    const pinned = template();
    pinned.theme = { id: "sample", version: "1.0.0", hash: `sha256:${"a".repeat(64)}` };
    assert.deepEqual(validateSeriesTemplate(pinned), []);
  });

  it("refuses a theme pin without its hash or with a range", () => {
    const doc = template();
    doc.theme = { id: "sample", version: "^1.0.0" };
    assert.ok(validateSeriesTemplate(doc).length > 0);
  });
});
