// The channel theme contract (studio/contracts, ADR-0040) and the composer's
// look vocabulary (lib/look) describe the same shape on two sides of a
// boundary the composer may not cross (it never imports the contracts). This
// holds them together: a theme the contract accepts draws in every neutral
// kit — its look and each of its characters pass the kits' own props schemas.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { BUNDLED_FAMILIES, KIT_VERSIONS } from "@av/remotion-composer";
import { BUNDLED_FONTS, validateChannelTheme, type ChannelTheme } from "@studio/contracts/src/channel-themes.mjs";

const require = createRequire(import.meta.url);
const themes: [string, ChannelTheme][] = [
  ["dentro-i-versi", JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "themes", "dentro-i-versi", "1.0.0", "theme.json"), "utf-8"))],
  ["sample (contracts)", JSON.parse(readFileSync(require.resolve("@studio/contracts/fixtures/channel-theme/sample/themes/sample/1.0.0/theme.json"), "utf-8"))],
];
/** The neutral kits: those whose props take a look. */
const neutral = KIT_VERSIONS.filter((k) => k.examples.some((e) => "look" in e.props));

test("the contract allows exactly the font families the composer bundles", () => {
  assert.deepEqual(Object.keys(BUNDLED_FONTS).sort(), [...BUNDLED_FAMILIES].sort());
});

test("the neutral kits are the lesson stage's ten", () => {
  assert.deepEqual(neutral.map((k) => `${k.name}@${k.version}`).sort(), [
    "block-title@1.0.0", "brand-mark@2.0.0", "chapter-opener@1.0.0", "cover@1.0.0", "figure-title@1.0.0",
    "interprete@1.1.0", "panel@1.0.0", "room@1.0.0", "verse-bar@1.0.0", "warp@1.0.0",
  ]);
});

for (const [name, theme] of themes) {
  test(`${name}: the contract accepts it`, () => {
    assert.deepEqual(validateChannelTheme(theme), []);
  });

  test(`${name}: its look draws in every neutral kit`, () => {
    for (const kit of neutral) {
      for (const example of kit.examples) {
        const result = kit.props.safeParse({ ...example.props, look: theme.look });
        assert.ok(result.success, `${kit.name}@${kit.version} ${example.id}: ${!result.success && JSON.stringify(result.error.issues)}`);
      }
    }
  });

  test(`${name}: each of its characters is drawn by interprete@1.1.0`, () => {
    const kit = KIT_VERSIONS.find((k) => k.name === "interprete" && k.version === "1.1.0")!;
    for (const [who, { poses: _poses, ...character }] of Object.entries(theme.characters)) {
      const result = kit.props.safeParse({ ...kit.examples[0]!.props, look: theme.look, character });
      assert.ok(result.success, `${who}: ${!result.success && JSON.stringify(result.error.issues)}`);
    }
  });
}
