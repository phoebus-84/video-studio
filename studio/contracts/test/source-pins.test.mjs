import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, utimes, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  describeChanges,
  hashFile,
  inventory,
  sourceDir,
  validateSourcePin,
  verifyPin,
} from "../src/source-pins.mjs";
import { CHANNEL_KNOWLEDGE, sourcePath } from "../src/layout.mjs";

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "source-pins-"));
  await mkdir(join(dir, "timing"), { recursive: true });
  await mkdir(join(dir, "assets", "takes"), { recursive: true });
  await writeFile(join(dir, "takes.json"), "{}");
  await writeFile(join(dir, "timing", "recitazione.json"), '{"words":[]}');
  await writeFile(join(dir, "assets", "takes", "recitazione.mp3"), "audio");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const pinOf = async (paths) => ({
  apiVersion: "studio.video/v1alpha1",
  kind: "SourcePin",
  id: "poesia",
  source: { kind: "channel-source", name: "il-lampo" },
  ...(paths ? { paths } : {}),
  usedBy: ["compile"],
  pinnedAt: "2026-10-05T18:00:00Z",
  files: await inventory(dir, paths),
});

/** A hash function that counts how many files it reads. */
function countingHash() {
  const counter = { reads: 0 };
  counter.hash = async (file) => {
    counter.reads += 1;
    return hashFile(file);
  };
  return counter;
}

describe("layout", () => {
  it("gives channels a sources folder and a path to each source", () => {
    assert.ok(CHANNEL_KNOWLEDGE.includes("sources"));
    assert.equal(sourcePath("/lib", "dentro-i-versi", "il-lampo"), join("/lib", "dentro-i-versi", "sources", "il-lampo"));
    assert.equal(sourceDir("/lib", "c", { kind: "channel-source", name: "x" }), join("/lib", "c", "sources", "x"));
    assert.equal(sourceDir("/lib", "c", { kind: "episode", series: "short", episode: "e" }), join("/lib", "c", "series", "short", "episodes", "e"));
  });
});

describe("inventory", () => {
  it("lists every file with its hash, size and mtime, sorted", async () => {
    const files = await inventory(dir);
    assert.deepEqual(Object.keys(files), ["assets/takes/recitazione.mp3", "takes.json", "timing/recitazione.json"]);
    assert.equal(files["takes.json"].hash, `sha256:${"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}`);
    assert.equal(files["takes.json"].size, 2);
    assert.equal(typeof files["takes.json"].mtimeMs, "number");
  });

  it("keeps an episode's runtime state and hidden files out", async () => {
    for (const d of ["journal", "attempts", "reviews", "output", ".workspace", "_media"]) {
      await mkdir(join(dir, d), { recursive: true });
      await writeFile(join(dir, d, "x"), "state");
    }
    await writeFile(join(dir, ".DS_Store"), "");
    assert.deepEqual(Object.keys(await inventory(dir)), ["assets/takes/recitazione.mp3", "takes.json", "timing/recitazione.json"]);
  });

  it("restricts itself to the pinned paths", async () => {
    assert.deepEqual(Object.keys(await inventory(dir, ["timing", "takes.json"])), ["takes.json", "timing/recitazione.json"]);
  });

  it("refuses a symlink", async () => {
    await symlink("/etc/hosts", join(dir, "outside"));
    await assert.rejects(() => inventory(dir), /outside is a symlink/);
  });
});

describe("verifyPin", () => {
  it("finds nothing when nothing changed, and reads no file", async () => {
    const pin = await pinOf();
    const counter = countingHash();
    assert.deepEqual(await verifyPin(pin, dir, { hash: counter.hash }), { changed: [] });
    assert.equal(counter.reads, 0);
  });

  it("reports modified, added and removed files", async () => {
    const pin = await pinOf();
    await writeFile(join(dir, "assets", "takes", "recitazione.mp3"), "a new take");
    await writeFile(join(dir, "timing", "new.json"), "{}");
    await rm(join(dir, "takes.json"));
    assert.deepEqual((await verifyPin(pin, dir)).changed, [
      { path: "assets/takes/recitazione.mp3", change: "modified" },
      { path: "takes.json", change: "removed" },
      { path: "timing/new.json", change: "added" },
    ]);
  });

  it("treats a file touched but not edited as unchanged, after reading only that file", async () => {
    const pin = await pinOf();
    const later = new Date(Date.now() + 60_000);
    await utimes(join(dir, "takes.json"), later, later);
    const counter = countingHash();
    assert.deepEqual(await verifyPin(pin, dir, { hash: counter.hash }), { changed: [] });
    assert.equal(counter.reads, 1);
  });

  it("only looks inside the pinned paths", async () => {
    const pin = await pinOf(["timing"]);
    await writeFile(join(dir, "takes.json"), "edited outside the pin");
    await writeFile(join(dir, "timing", "new.json"), "{}");
    assert.deepEqual((await verifyPin(pin, dir)).changed, [{ path: "timing/new.json", change: "added" }]);
  });

  it("reports every file of a source that disappeared", async () => {
    const pin = await pinOf();
    await rm(dir, { recursive: true, force: true });
    assert.equal((await verifyPin(pin, dir)).changed.length, 3);
  });
});

describe("validateSourcePin and describeChanges", () => {
  it("accepts a pin it made and refuses broken ones", async () => {
    const pin = await pinOf(["timing"]);
    assert.deepEqual(validateSourcePin(pin), []);
    assert.deepEqual(validateSourcePin({ ...pin, usedBy: [] }).map((p) => p.code), ["schema"]);
    assert.ok(validateSourcePin({ ...pin, paths: ["../elsewhere"] }).length > 0);
    assert.ok(validateSourcePin({ ...pin, source: { kind: "channel-source" } }).length > 0);
  });

  it("names at most five changes", () => {
    const changed = Array.from({ length: 7 }, (_, i) => ({ path: `f${i}`, change: "added" }));
    assert.equal(describeChanges(changed), "f0 (added), f1 (added), f2 (added), f3 (added), f4 (added) and 2 more");
  });
});
