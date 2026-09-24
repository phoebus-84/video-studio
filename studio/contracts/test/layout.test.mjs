import test from "node:test";
import assert from "node:assert/strict";
import {
  EPISODE_SCRATCH,
  EPISODE_DIRECTORIES,
  EPISODE_FILES,
  EPISODE_SEED_FILES,
  EPISODE_TREE,
} from "../src/layout.mjs";

test("the scratch area is named and is part of the tree", () => {
  assert.equal(EPISODE_SCRATCH, "production");
  assert.ok(EPISODE_DIRECTORIES.includes(EPISODE_SCRATCH));
  assert.ok(EPISODE_TREE.includes(EPISODE_SCRATCH));
});

test("the tree is exactly the directories plus the files plus the workspace marker", () => {
  assert.deepEqual(
    [...EPISODE_TREE].sort(),
    [...EPISODE_DIRECTORIES, ...EPISODE_FILES,
     ".workspace/contract.json", ".workspace/metadata.json"].sort(),
  );
});

test("the tree keeps the directories the artifact resolver already looks in", () => {
  // discovery.ts maps animated-visuals.mp4 to assets/animation/visuals.mp4, so
  // an episode without that directory is missing one the resolver searches.
  for (const dir of ["assets/images", "assets/graphics", "assets/audio", "assets/animation"]) {
    assert.ok(EPISODE_DIRECTORIES.includes(dir), `${dir} is missing`);
  }
});

test("every seeded file except the manifest has a fixed body", () => {
  // episode.yaml is deliberately absent: its body names the episode, so
  // renderEpisodeManifest builds it rather than a constant.
  assert.deepEqual(
    Object.keys(EPISODE_SEED_FILES).sort(),
    EPISODE_FILES.filter((f) => f !== "episode.yaml").slice().sort(),
  );
});

test("the seeded JSON bodies parse and end with a newline", () => {
  for (const [name, body] of Object.entries(EPISODE_SEED_FILES)) {
    if (!name.endsWith(".json")) continue;
    assert.doesNotThrow(() => JSON.parse(body), name);
    assert.ok(body.endsWith("\n"), `${name} should end with a newline`);
  }
});

test("the lists are frozen", () => {
  assert.throws(() => { EPISODE_TREE.push("nope"); });
});
