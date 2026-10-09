import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileEpisode, libraryKitsOf, loadEpisode } from "../src/series-compile.js";
import { sealKit, verifyKit } from "../src/kit-code.js";
import { sealTemplateCode, TemplateCodeError } from "../src/template-code.js";
import { writeEditTimeline } from "../src/episode-render.js";
import { makeLayoutSheet } from "../src/layout-sheet.js";
import { editSpec, releaseCodeEpisode, sha256 } from "../src/testing.js";

/**
 * Kits a channel or a series carries (avg-d1x): sealed in the library,
 * pinned by a series release, loaded with it, drawn by its compiler and
 * handed to the layout sheet. The sheet's rendering is faked here; the
 * composer's own end-to-end test draws a library kit for real.
 */

const sheetCalls: { kits?: unknown }[] = [];
vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderLayoutSheet: async (options: { timeline: any; picks: { frame: number; label: string }[]; outDir: string; kits?: unknown }) => {
      sheetCalls.push(options);
      mkdirSync(join(options.outDir, "frames"), { recursive: true });
      const frames = options.picks.map((p, index) => {
        const path = join(options.outDir, "frames", `${String(index).padStart(3, "0")}.jpg`);
        writeFileSync(path, `still ${p.frame}`);
        return { index, frame: p.frame, seconds: p.frame / options.timeline.fps, label: p.label, path, hash: sha256(`still ${p.frame}`) };
      });
      const path = join(options.outDir, "sheet.jpg");
      writeFileSync(path, "sheet");
      return { frames, sheet: { path, hash: sha256("sheet"), columns: 8, rows: 1, width: 2160, height: 1600 }, kits: actual.timelineKits(options.timeline, options.kits as never)! };
    },
  };
});

const require = createRequire(import.meta.url);
const FIXTURES = dirname(require.resolve("@studio/series/fixtures/release-code/sample-card/compiler.ts"));
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const channelDir = () => join(root, REF.channel);
const seriesDir = () => join(channelDir(), "series", REF.series);
const dir = () => join(seriesDir(), "episodes", REF.episode);
const opts = { episodeRef: REF };

/** The channel's sample card, sealed in library/<channel>/kits/sample-card/1.0.0 (or the series' own kits/). */
async function sealedCard(level: "channel" | "series" = "channel") {
  const kitDir = join(level === "series" ? seriesDir() : channelDir(), "kits", "sample-card", "1.0.0");
  cpSync(join(FIXTURES, "kit"), join(kitDir, "kit"), { recursive: true });
  const sealed = await sealKit({ channelDir: channelDir(), ...(level === "series" ? { series: REF.series } : {}), name: "sample-card", version: "1.0.0" });
  return { kitDir, sealed };
}

/** The release drawing the card: the wrapping compiler, the kit pinned, sealed again with the spec aside. */
async function releaseDrawingTheCard(level: "channel" | "series" = "channel") {
  const { releaseDir } = await releaseCodeEpisode(dir(), REF);
  cpSync(join(releaseDir, "compiler", "index.ts"), join(releaseDir, "compiler", "base.ts"));
  cpSync(join(FIXTURES, "compiler.ts"), join(releaseDir, "compiler", "index.ts"));
  const manifestFile = join(releaseDir, "series-template.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
  manifest.kits = [{ name: "sample-card", version: "1.0.0", level }];
  // poetry-short's rules allow no extra track: this release draws the card without them.
  delete manifest.validator;
  rmSync(join(releaseDir, "validator"), { recursive: true });
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const spec = join(dir(), "episode-spec.json");
  renameSync(spec, `${spec}.aside`);
  const sealed = await sealTemplateCode(seriesDir(), "poetry-short", "1.0.0");
  renameSync(`${spec}.aside`, spec);
  editSpec(dir(), (doc) => { doc.template.hash = sealed.hash; });
  return { releaseDir, manifestFile };
}

async function refusal(call: () => Promise<unknown>): Promise<TemplateCodeError> {
  try {
    await call();
  } catch (e) {
    if (e instanceof TemplateCodeError) return e;
    throw e;
  }
  throw new Error("expected a TemplateCodeError");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "library-kits-"));
  sheetCalls.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a kit the channel carries", () => {
  it("is sealed into kit.cjs and kit.json, pinned by the release, and drawn by its compiler", async () => {
    const { kitDir, sealed } = await sealedCard();
    const release = JSON.parse(readFileSync(join(kitDir, "kit.json"), "utf-8"));
    expect(release).toEqual({ apiVersion: "studio.video/v1alpha1", kind: "KitRelease", name: "sample-card", version: "1.0.0", bundle: { path: "kit.cjs", hash: sealed.bundle.hash } });
    expect(sealed.hash).toBe(sha256(readFileSync(join(kitDir, "kit.json"))));

    const { manifestFile } = await releaseDrawingTheCard();
    expect(JSON.parse(readFileSync(manifestFile, "utf-8")).kits).toEqual([{ name: "sample-card", version: "1.0.0", level: "channel", hash: sealed.hash }]);

    const compiled = compileEpisode(dir(), opts);
    expect(compiled.ok, JSON.stringify(!compiled.ok && compiled.problems)).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.timeline.tracks.find((t) => t.id === "library")!.items[0]).toMatchObject({ kit: { name: "sample-card", version: "1.0.0" } });
    const inputs = compiled.timeline.metadata!.inputs as Record<string, string>;
    expect(inputs["../../../../kits/sample-card/1.0.0/kit.json"]).toBe(sealed.hash);
    expect(inputs["../../../../kits/sample-card/1.0.0/kit.cjs"]).toBe(sealed.bundle.hash);
  });

  it("goes to the layout sheet, which locks it by its bundle's hash", async () => {
    const { sealed } = await sealedCard();
    await releaseDrawingTheCard();
    writeEditTimeline(dir(), opts);
    const kits = libraryKitsOf(dir(), opts);
    expect(kits).toEqual([{ name: "sample-card", version: "1.0.0", file: join(channelDir(), "kits", "sample-card", "1.0.0", "kit.cjs"), hash: sealed.bundle.hash }]);
    const sheet = await makeLayoutSheet(dir(), opts);
    expect(sheetCalls[0]!.kits).toEqual(kits);
    expect(sheet.report.kits).toContainEqual({ name: "sample-card", version: "1.0.0", hash: sealed.bundle.hash });
  });

  it("is refused when its bundle or its kit.json is not the sealed one", async () => {
    const { kitDir } = await sealedCard();
    await releaseDrawingTheCard();
    appendFileSync(join(kitDir, "kit.cjs"), "\n// changed");
    const bundle = loadEpisode(dir(), opts);
    expect(!bundle.ok && bundle.problems[0]!.code).toBe("kit-mismatch");

    const manifest = readFileSync(join(kitDir, "kit.json"), "utf-8");
    writeFileSync(join(kitDir, "kit.json"), manifest.replace('"1.0.0"', '"1.0.0" '));
    const pin = loadEpisode(dir(), opts);
    expect(!pin.ok && pin.problems[0]).toMatchObject({ code: "kit-mismatch", path: "../../../../kits/sample-card/1.0.0/kit.json" });
  });

  it("is never resealed once a release pins it, and a release cannot pin an unsealed kit", async () => {
    await sealedCard();
    await releaseDrawingTheCard();
    const again = await refusal(() => sealKit({ channelDir: channelDir(), name: "sample-card", version: "1.0.0" }));
    expect([again.code, again.message]).toEqual(["release-pinned", expect.stringContaining("poetry/poetry-short@1.0.0")]);

    rmSync(join(channelDir(), "kits"), { recursive: true });
    rmSync(join(dir(), "episode-spec.json"));
    const unsealed = await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"));
    expect([unsealed.code, unsealed.message]).toEqual(["bad-template", expect.stringContaining("channel kit sample-card@1.0.0")]);
  });

  it("refuses to seal a kit that is not its folder's name, or takes an application kit's", async () => {
    const kitDir = join(channelDir(), "kits", "other-card", "1.0.0");
    cpSync(join(FIXTURES, "kit"), join(kitDir, "kit"), { recursive: true });
    const other = await refusal(() => sealKit({ channelDir: channelDir(), name: "other-card", version: "1.0.0" }));
    expect([other.code, other.message]).toEqual(["bad-kit", expect.stringContaining("exports sample-card@1.0.0")]);
    cpSync(join(FIXTURES, "kit"), join(channelDir(), "kits", "still", "1.0.0", "kit"), { recursive: true });
    const still = await refusal(() => sealKit({ channelDir: channelDir(), name: "still", version: "1.0.0" }));
    expect([still.code, still.message]).toEqual(["kit-shadows", expect.stringContaining("application kit")]);
    expect((await refusal(() => sealKit({ channelDir: channelDir(), name: "nowhere", version: "1.0.0" }))).code).toBe("missing-kit");
  });

  it("refuses a pin that is not a pin, or a kit pinned twice, before touching the disk", async () => {
    await sealedCard();
    const { manifestFile } = await releaseDrawingTheCard();
    rmSync(join(dir(), "episode-spec.json"));
    const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
    for (const [kits, said] of [
      [[null], "kits[0] is not a kit pin"],
      [[{ name: "../../x", version: "1.0.0", level: "channel" }], "kits[0] is not a kit pin"],
      [[{ name: "sample-card", version: "1.0.0" }], "kits[0] is not a kit pin"],
      [[{ name: "sample-card", version: "1.0.0", level: "channel" }, { name: "sample-card", version: "1.0.0", level: "series" }], "pinned twice"],
    ] as const) {
      writeFileSync(manifestFile, `${JSON.stringify({ ...manifest, kits }, null, 2)}\n`);
      const e = await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"));
      expect([e.code, e.message]).toEqual(["bad-template", expect.stringContaining(said)]);
    }
  });
});

it("a series' own kit works the same, from the series' kits/", async () => {
  const { kitDir } = await sealedCard("series");
  expect(kitDir).toBe(join(seriesDir(), "kits", "sample-card", "1.0.0"));
  await releaseDrawingTheCard("series");
  const compiled = compileEpisode(dir(), opts);
  expect(compiled.ok, JSON.stringify(!compiled.ok && compiled.problems)).toBe(true);
});

describe("verifying a kit", () => {
  it("passes a sealed kit, warns when its source moved on, and holds its examples to its props", async () => {
    const { kitDir } = await sealedCard();
    const place = { channelDir: channelDir(), name: "sample-card", version: "1.0.0" };
    expect(await verifyKit(place)).toEqual({ ok: true, problems: [], warnings: [], examples: [{ id: "navy", ok: true }] });
    appendFileSync(join(kitDir, "kit", "index.tsx"), "\nexport const extra = 1;\n");
    expect((await verifyKit(place)).warnings.map((w) => w.code)).toEqual(["rebuild-differs"]);
    appendFileSync(join(kitDir, "kit.cjs"), "\n// changed");
    expect((await verifyKit(place)).problems.map((p) => p.code)).toEqual(["kit-mismatch"]);
  });
});
