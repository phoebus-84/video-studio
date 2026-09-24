import test from "node:test";
import assert from "node:assert/strict";
import { EPISODE_MANIFEST_FILE, renderEpisodeManifest } from "../src/episode-manifest.mjs";

test("the manifest file is episode.yaml", () => {
  assert.equal(EPISODE_MANIFEST_FILE, "episode.yaml");
});

test("a manifest with only a slug renders the required keys and nothing else", () => {
  const out = renderEpisodeManifest({ slug: "cinderella" });
  assert.match(out, /^apiVersion: studio\.video\/v1alpha1$/m);
  assert.match(out, /^kind: Episode$/m);
  assert.match(out, /^slug: "cinderella"$/m);
  assert.doesNotMatch(out, /^title:/m);
  assert.doesNotMatch(out, /^createdAt:/m);
  assert.ok(out.endsWith("\n"));
});

test("an optional field with no value is omitted rather than written empty", () => {
  // The migration has episodes with no recorded creation time. A manifest
  // claiming `createdAt: ""` would be asserting a fact nobody holds.
  const out = renderEpisodeManifest({ slug: "tomb", title: "Tomb", createdAt: undefined });
  assert.doesNotMatch(out, /createdAt/);
});

test("values are quoted, so a colon in a title cannot break the document", () => {
  const out = renderEpisodeManifest({
    slug: "giulio-cesare",
    title: "Julius Caesar: The Man Who Changed Rome",
  });
  assert.match(out, /^title: "Julius Caesar: The Man Who Changed Rome"$/m);
});

test("a quote in a title is escaped", () => {
  const out = renderEpisodeManifest({ slug: "x", title: 'The "Best" Episode' });
  assert.match(out, /^title: "The \\"Best\\" Episode"$/m);
});

test("a manifest without a slug is refused", () => {
  assert.throws(() => renderEpisodeManifest({ title: "No slug" }), /slug/);
});
