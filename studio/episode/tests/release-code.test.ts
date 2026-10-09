import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkEpisode, compileEpisode, loadEpisode } from "../src/series-compile.js";
import { sealTemplateCode, TemplateCodeError, verifyTemplateCode } from "../src/template-code.js";
import { editSpec, releaseCodeEpisode, specEpisode } from "../src/testing.js";

/**
 * A series release that runs its own code (avg-d1x): its compiler and
 * validator sealed into the release as bundles, loaded from there, and the
 * same as the registered ones they were copied from.
 */

const require = createRequire(import.meta.url);
const POETRY_INPUT = require.resolve("@studio/series/fixtures/poetry-short/1.0.0/input.json");
const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = (episode = REF.episode) => join(root, REF.channel, "series", REF.series, "episodes", episode);
const seriesDir = () => join(root, REF.channel, "series", REF.series);
const opts = (episode = REF.episode) => ({ episodeRef: { ...REF, episode } });

/** Throws the TemplateCodeError a call makes, or fails. */
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
  root = mkdtempSync(join(tmpdir(), "release-code-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a release that runs its own code", () => {
  it("compiles exactly as the registered compiler it was copied from", async () => {
    const { releaseDir } = await releaseCodeEpisode(dir(), REF);
    const own = compileEpisode(dir(), opts());
    expect(own.ok, JSON.stringify(!own.ok && own.problems)).toBe(true);

    // The same episode on the registered poetry-short@1.0.0, in another series of the library.
    const otherRef = { channel: "sample", series: "registered", episode: "morning" };
    const otherDir = join(root, "sample", "series", "registered", "episodes", "morning");
    specEpisode(otherDir, otherRef);
    const registered = compileEpisode(otherDir, { episodeRef: otherRef });
    expect(registered.ok).toBe(true);
    if (!own.ok || !registered.ok) return;
    const drawn = (t: any) => ({ tracks: t.tracks, assets: t.assets, sections: t.sections, durationInFrames: t.durationInFrames, profile: t.profile });
    expect(drawn(own.timeline)).toEqual(drawn(registered.timeline));

    // The code ran from the release, and its bundle is one of the inputs the timeline records.
    const bundle = JSON.parse(readFileSync(join(releaseDir, "series-template.json"), "utf-8")).compiler.bundle;
    expect(bundle.path).toBe("compiler/compiler.cjs");
    expect((own.timeline.metadata?.inputs as Record<string, string>)["../../templates/poetry-short/1.0.0/compiler/compiler.cjs"]).toBe(bundle.hash);
  });

  it("checks the timeline with the release's own validator", async () => {
    await releaseCodeEpisode(dir(), REF);
    const checked = checkEpisode(dir(), opts());
    expect(checked.ok && checked.validator).toBe("poetry-short@1.0.0");
  });

  it("refuses a bundle that is not the sealed one, or is missing", async () => {
    const { releaseDir } = await releaseCodeEpisode(dir(), REF);
    appendFileSync(join(releaseDir, "compiler", "compiler.cjs"), "\n// changed");
    const changed = loadEpisode(dir(), opts());
    expect(!changed.ok && changed.problems[0]).toMatchObject({ code: "code-mismatch", path: "../../templates/poetry-short/1.0.0/compiler/compiler.cjs" });
    rmSync(join(releaseDir, "compiler", "compiler.cjs"));
    const missing = loadEpisode(dir(), opts());
    expect(!missing.ok && missing.problems[0]!.code).toBe("missing-code");
  });

  it("refuses code that exports no compiler: sealing it, and loading a bundle made by hand", async () => {
    specEpisode(dir(), REF);
    const releaseDir = join(seriesDir(), "templates", "poetry-short", "1.0.0");
    mkdirSync(join(releaseDir, "compiler"), { recursive: true });
    writeFileSync(join(releaseDir, "compiler", "index.ts"), "export const nothing = 1;\n");
    const spec = join(dir(), "episode-spec.json");
    const aside = readFileSync(spec);
    rmSync(spec);
    const sealing = await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"));
    expect([sealing.code, sealing.message]).toEqual(["bad-code", expect.stringContaining("export const compiler")]);

    // A bundle no seal made: the loader holds it to the same rule.
    const bundle = "module.exports = { nothing: 1 };\n";
    writeFileSync(join(releaseDir, "compiler", "compiler.cjs"), bundle);
    const manifestFile = join(releaseDir, "series-template.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
    manifest.compiler.bundle = { path: "compiler/compiler.cjs", hash: `sha256:${createHash("sha256").update(bundle).digest("hex")}` };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(manifestFile, manifestText);
    writeFileSync(spec, aside);
    editSpec(dir(), (doc) => { doc.template.hash = `sha256:${createHash("sha256").update(manifestText).digest("hex")}`; });
    const empty = loadEpisode(dir(), opts());
    expect(!empty.ok && empty.problems[0]).toMatchObject({ code: "bad-code" });
    expect(!empty.ok && empty.problems[0]!.message).toContain("export const compiler");
  });

  it("refuses to seal code that is another version than the one the release names", async () => {
    const { releaseDir } = await releaseCodeEpisode(dir(), REF);
    rmSync(join(dir(), "episode-spec.json"));
    const manifestFile = join(releaseDir, "series-template.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
    manifest.compiler.version = "9.9.9";
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const e = await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"));
    expect(e.code).toBe("bad-code");
    expect(e.message).toContain("poetry-short@1.0.0, not the poetry-short@9.9.9");
  });
});

describe("sealing", () => {
  it("is refused once an episode pins the release", async () => {
    await releaseCodeEpisode(dir(), REF);
    const e = await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"));
    expect(e.code).toBe("release-pinned");
    expect(e.message).toContain(REF.episode);
  });

  it("names a source that does not build, and writes nothing", async () => {
    specEpisode(dir(), REF);
    rmSync(join(dir(), "episode-spec.json"));
    const releaseDir = join(seriesDir(), "templates", "poetry-short", "1.0.0");
    const before = readFileSync(join(releaseDir, "series-template.json"), "utf-8");
    mkdirSync(join(releaseDir, "compiler"), { recursive: true });
    writeFileSync(join(releaseDir, "compiler", "index.ts"), "import { nowhere } from \"./missing.js\";\nexport const compiler = nowhere;\n");
    const e = await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"));
    expect(e.code).toBe("build-failed");
    expect(e.message).toContain("missing.js");
    expect(readFileSync(join(releaseDir, "series-template.json"), "utf-8")).toBe(before);
  });

  it("builds the same bundle wherever the library is, naming no path of this machine", async () => {
    const a = await releaseCodeEpisode(dir(), REF);
    // Deeper, and so another way from the app: module names must not depend on it.
    const elsewhere = mkdtempSync(join(tmpdir(), "release-code-elsewhere-"));
    try {
      const deep = join(elsewhere, "a", "b", "c", "x", "series", "poetry", "episodes", "e");
      const b = await releaseCodeEpisode(deep, { channel: "x", series: "poetry", episode: "e" });
      const bundle = (r: string) => readFileSync(join(r, "compiler", "compiler.cjs"), "utf-8");
      expect(bundle(b.releaseDir)).toBe(bundle(a.releaseDir));
      for (const text of [bundle(a.releaseDir), readFileSync(join(a.releaseDir, "validator", "validator.cjs"), "utf-8")]) {
        expect(text).not.toContain(tmpdir());
        expect(text).not.toContain(process.cwd());
        expect(text).not.toMatch(/\/Users\/|node_modules\//);
      }
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("counts the series' golden references as pins, and an unreadable spec too", async () => {
    specEpisode(dir(), REF);
    const releaseDir = join(seriesDir(), "templates", "poetry-short", "1.0.0");
    cpSync(join(dirname(require.resolve("@studio/series/fixtures/release-code/poetry-short/compiler/index.ts")), ".."), releaseDir, { recursive: true });
    writeFileSync(join(dir(), "episode-spec.json"), "{ not json");
    expect((await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"))).message).toContain("morning (unreadable)");
    rmSync(join(dir(), "episode-spec.json"));
    mkdirSync(join(seriesDir(), "templates", "poetry-short", "references"), { recursive: true });
    writeFileSync(join(seriesDir(), "templates", "poetry-short", "references", "morning-v1.json"), JSON.stringify({ template: { id: "poetry-short", version: "1.0.0", hash: "sha256:x" } }));
    expect((await refusal(() => sealTemplateCode(seriesDir(), "poetry-short", "1.0.0"))).message).toContain("reference morning-v1");
  });
});

describe("verifying", () => {
  /** A release with code and one fixture: poetry-short's golden input. */
  async function withFixture() {
    const { releaseDir } = await releaseCodeEpisode(dir(), REF);
    mkdirSync(join(releaseDir, "fixtures", "morning"), { recursive: true });
    cpSync(POETRY_INPUT, join(releaseDir, "fixtures", "morning", "input.json"));
    return releaseDir;
  }

  it("asks for the goldens, writes them when told to before any episode pins it, then passes", async () => {
    const releaseDir = await withFixture();
    const first = await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    expect(first.ok).toBe(false);
    expect(first.fixtures).toEqual([{ name: "morning", ok: false, message: "no expected-timeline.json: verify --update writes it" }]);

    expect((await refusal(() => verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0", { update: true }))).code).toBe("release-pinned");
    rmSync(join(dir(), "episode-spec.json"));
    await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0", { update: true });
    const verified = await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    expect(verified).toEqual({ ok: true, problems: [], warnings: [], fixtures: [{ name: "morning", ok: true }] });
    expect(readFileSync(join(releaseDir, "fixtures", "morning", "expected-timeline.json"), "utf-8")).toContain('"kind": "EditTimeline"');
  });

  it("warns of a source changed after sealing, and finds a changed bundle and a golden that no longer matches", async () => {
    const releaseDir = await withFixture();
    rmSync(join(dir(), "episode-spec.json"));
    await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0", { update: true });

    // The sealed bundle is what runs: a source (or toolbox) that moved on is worth knowing, not a failure.
    appendFileSync(join(releaseDir, "compiler", "index.ts"), "\nexport const extra = 1;\n");
    const moved = await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    expect([moved.ok, moved.problems, moved.warnings.map((w) => w.code)]).toEqual([true, [], ["rebuild-differs"]]);

    writeFileSync(join(releaseDir, "fixtures", "morning", "expected-timeline.json"), "{}\n");
    const golden = await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    expect(golden.fixtures[0]).toEqual({ name: "morning", ok: false, message: "compiles differently from its expected-timeline.json" });

    appendFileSync(join(releaseDir, "validator", "validator.cjs"), "\n// changed");
    expect((await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0")).problems.map((p) => p.code)).toContain("code-mismatch");
  });

  it("reports a malformed fixture and a fixture without input as failed, never crashing", async () => {
    const releaseDir = await withFixture();
    mkdirSync(join(releaseDir, "fixtures", "broken"), { recursive: true });
    writeFileSync(join(releaseDir, "fixtures", "broken", "input.json"), "{ not json");
    mkdirSync(join(releaseDir, "fixtures", "empty"), { recursive: true });
    mkdirSync(join(releaseDir, "fixtures", "nospec"), { recursive: true });
    writeFileSync(join(releaseDir, "fixtures", "nospec", "input.json"), "{}");
    const verified = await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0");
    const by = Object.fromEntries(verified.fixtures.map((f) => [f.name, f]));
    expect(by.broken!.ok).toBe(false);
    expect(by.empty).toEqual({ name: "empty", ok: false, message: "input.json: missing" });
    expect(by.nospec).toEqual({ name: "nospec", ok: false, message: "input.json: not a compile input (no spec)" });
  });

  it("writes no golden on a dry run, pinned or not", async () => {
    const releaseDir = await withFixture();
    const dry = await verifyTemplateCode(seriesDir(), "poetry-short", "1.0.0", { update: true, dryRun: true });
    expect(dry.fixtures).toEqual([{ name: "morning", ok: true, message: "golden would be written" }]);
    expect(existsSync(join(releaseDir, "fixtures", "morning", "expected-timeline.json"))).toBe(false);
  });
});

it("leaves a release without code on the registered compiler", () => {
  specEpisode(dir(), REF);
  const compiled = compileEpisode(dir(), opts());
  expect(compiled.ok).toBe(true);
  expect(dirname(POETRY_INPUT)).toContain("poetry-short");
});
