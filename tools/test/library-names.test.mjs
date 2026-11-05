import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { libraryNames, findNames } from "../check-library-names.mjs";

async function library(t) {
  const root = await mkdtemp(join(tmpdir(), "library-names-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const series = join(root, "harbour-tales", "series", "night-shift");
  await mkdir(join(series, "episodes", "the-lighthouse"), { recursive: true });
  await mkdir(join(series, "templates", "night-shift-short"), { recursive: true });
  await mkdir(join(root, "harbour-tales", "sources", "fog-bell"), { recursive: true });
  await mkdir(join(root, ".render"), { recursive: true });
  await writeFile(join(root, "harbour-tales", "channel.md"), "---\ntitle: Harbour Tales\n---\n");
  await writeFile(join(series, "episodes", "the-lighthouse", "episode.yaml"), "title: \"The Lighthouse Keeper\"\n");
  return root;
}

test("a library gives its channel, series, episode, source and template names, and its titles that are not its slugs", async (t) => {
  const names = libraryNames(await library(t));
  assert.deepEqual(
    names.map((n) => `${n.kind}:${n.name}`).sort(),
    [
      "channel:harbour-tales",
      "episode title:The Lighthouse Keeper",
      "episode:the-lighthouse",
      "series:night-shift",
      "source:fog-bell",
      "template:night-shift-short",
    ],
  );
});

test("a slug is found as written and as words; a longer word containing it is not", async (t) => {
  const names = libraryNames(await library(t));
  const hits = findNames(
    [
      { path: "skills/a.md", text: "Use it for night-shift.\nThe Night Shift episodes.\nnight-shifts are fine" },
      { path: "docs/b.md", text: "nothing here\nOn harbour tales the rule is" },
    ],
    names,
  );
  assert.deepEqual(hits.map((h) => `${h.path}:${h.line}:${h.name}`), [
    "skills/a.md:1:night-shift",
    "skills/a.md:2:night-shift",
    "docs/b.md:2:harbour-tales",
  ]);
});

test("an allowed name is not reported, and structural folder names are never names", async (t) => {
  const root = await library(t);
  await mkdir(join(root, "intro", "series", "series"), { recursive: true });
  const names = libraryNames(root);
  assert.equal(names.some((n) => n.name === "series"), false);
  const hits = findNames([{ path: "docs/c.md", text: "An intro to the studio." }], names, new Set(["intro"]));
  assert.deepEqual(hits, []);
});
