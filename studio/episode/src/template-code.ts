// ---------------------------------------------------------------------------
// Sealing and verifying a series release's own code (avg-d1x)
// ---------------------------------------------------------------------------
// A series template release may hold its compiler and validator as source:
// compiler/index.ts and validator/index.ts, exporting `compiler` and
// `validator`. Sealing builds each into one self-contained CommonJS file
// (esbuild: the toolbox and the contracts' helpers it imports are inlined, so
// a later change to them never alters this release) and names it, with its
// hash, in series-template.json. Verifying checks the bundles are the sealed
// ones, that the source still builds to them, and that the release's fixtures
// compile to their golden timelines.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { compileSpec, checkSeries } from "@studio/series";
import { SERIES_TEMPLATE_MANIFEST } from "@studio/contracts/src/layout.mjs";
import { SERIES_TEMPLATE_FILES, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
import { releaseCodeOf } from "./release-code.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ROLES = ["compiler", "validator"] as const;
type Role = (typeof ROLES)[number];

export type TemplateCodeCode = "missing-template" | "bad-template" | "release-pinned" | "build-failed" | "no-code" | "no-esbuild";

export class TemplateCodeError extends Error {
  constructor(readonly code: TemplateCodeCode, message: string) {
    super(message);
    this.name = "TemplateCodeError";
  }
}

const fail = (code: TemplateCodeCode, message: string): never => {
  throw new TemplateCodeError(code, message);
};
const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sourceOf = (releaseDir: string, role: Role) => join(releaseDir, role, "index.ts");
const bundlePath = (role: Role) => `${role}/${role}.cjs`;

function releaseDirOf(seriesDir: string, id: string, version: string): string {
  if (!SLUG.test(id)) fail("missing-template", `"${id}" is not a template id`);
  if (!EXACT.test(version)) fail("missing-template", `"${version}" is not an exact x.y.z release`);
  const dir = join(seriesDir, "templates", id, version);
  if (!existsSync(join(dir, SERIES_TEMPLATE_MANIFEST))) fail("missing-template", `${id}@${version} is not in this series`);
  return dir;
}

function readManifest(releaseDir: string, label: string): { manifest: any; text: string } {
  const text = readFileSync(join(releaseDir, SERIES_TEMPLATE_MANIFEST), "utf-8");
  try {
    const manifest = JSON.parse(text);
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("not an object");
    return { manifest, text };
  } catch (error) {
    return fail("bad-template", `${label}'s ${SERIES_TEMPLATE_MANIFEST} is not a release manifest: ${(error as Error).message}`);
  }
}

/** The episodes of this series whose spec pins the release. */
function pinnedBy(seriesDir: string, id: string, version: string): string[] {
  const episodes = join(seriesDir, "episodes");
  if (!existsSync(episodes)) return [];
  return readdirSync(episodes).filter((name) => {
    try {
      const spec = JSON.parse(readFileSync(join(episodes, name, "episode-spec.json"), "utf-8"));
      return spec?.template?.id === id && spec?.template?.version === version;
    } catch {
      return false;
    }
  }).sort();
}

/** One self-contained CommonJS bundle of a role's source; the app's packages resolve from its node_modules. */
async function build(releaseDir: string, role: Role): Promise<string> {
  const require = createRequire(import.meta.url);
  let esbuild: typeof import("esbuild");
  let nodeModules: string;
  try {
    const main = require.resolve("esbuild");
    esbuild = require(main);
    nodeModules = dirname(dirname(dirname(main)));
  } catch {
    return fail("no-esbuild", "esbuild is not installed beside the studio: it builds a release's code");
  }
  try {
    const out = await esbuild.build({
      entryPoints: [sourceOf(releaseDir, role)],
      absWorkingDir: releaseDir,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node20",
      write: false,
      nodePaths: [nodeModules],
      // No path comments: the bundle is the same wherever the library and the app sit.
      minifyWhitespace: true,
      legalComments: "none",
      logLevel: "silent",
    });
    return out.outputFiles[0]!.text;
  } catch (error) {
    const errors = (error as { errors?: { text: string; location?: { file: string; line: number } }[] }).errors ?? [];
    const detail = errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`).join("; ");
    return fail("build-failed", `${role}/index.ts does not build: ${detail || (error as Error).message}`);
  }
}

export interface SealedCode {
  /** The manifest's hash: what an episode pins. */
  hash: string;
  code: Partial<Record<Role, { path: string; hash: string }>>;
}

/**
 * Build the release's compiler/ and validator/ sources into their bundles and
 * name them, with every file's hash, in its manifest. Refused once an episode
 * pins the release: a pinned release never changes.
 */
export async function sealTemplateCode(seriesDir: string, id: string, version: string, options: { dryRun?: boolean } = {}): Promise<SealedCode> {
  const releaseDir = releaseDirOf(seriesDir, id, version);
  const label = `${id}@${version}`;
  const pinned = pinnedBy(seriesDir, id, version);
  if (pinned.length > 0) fail("release-pinned", `${label} is pinned by ${pinned.join(", ")}: a pinned release never changes; make a new one (vpr template release --from ${version})`);
  const { manifest } = readManifest(releaseDir, label);

  const built: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    if (!existsSync(sourceOf(releaseDir, role))) continue;
    if (!manifest[role] || typeof manifest[role] !== "object") fail("bad-template", `${label} has ${role}/index.ts but its manifest names no ${role} (id and version)`);
    built[role] = await build(releaseDir, role);
    manifest[role] = { id: manifest[role].id, version: manifest[role].version, bundle: { path: bundlePath(role), hash: sha256(built[role]!) } };
  }
  if (Object.keys(built).length === 0) fail("no-code", `${label} has neither compiler/index.ts nor validator/index.ts`);

  const files: Record<string, string> = {};
  for (const [roleName, name] of Object.entries(SERIES_TEMPLATE_FILES)) {
    const file = join(releaseDir, name);
    if (!existsSync(file)) fail("missing-template", `${label} has no ${name}`);
    files[name] = readFileSync(file, "utf-8");
    manifest.files[roleName] = { path: name, hash: sha256(files[name]!) };
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const problems = validateTemplateBundle({ manifest: manifestText, files });
  if (problems.length > 0) fail("bad-template", problems.map((p: { code: string; path: string; message: string }) => `${p.code} at ${p.path}: ${p.message}`).join("; "));

  const result: SealedCode = {
    hash: sha256(manifestText),
    code: Object.fromEntries(Object.keys(built).map((role) => [role, manifest[role].bundle])),
  };
  if (options.dryRun) return result;
  for (const [role, text] of Object.entries(built)) {
    const target = join(releaseDir, bundlePath(role as Role));
    writeFileSync(`${target}.tmp`, text);
    renameSync(`${target}.tmp`, target);
  }
  const manifestFile = join(releaseDir, SERIES_TEMPLATE_MANIFEST);
  writeFileSync(`${manifestFile}.tmp`, manifestText);
  renameSync(`${manifestFile}.tmp`, manifestFile);
  return result;
}

export interface CodeVerification {
  ok: boolean;
  problems: { code: string; message: string }[];
  fixtures: { name: string; ok: boolean; message?: string }[];
}

/**
 * Is the release's code the sealed code, does its source still build to it,
 * and do its fixtures (fixtures/<name>/input.json) compile to their golden
 * timelines (expected-timeline.json)? `update` writes the goldens instead,
 * refused once an episode pins the release.
 */
export async function verifyTemplateCode(seriesDir: string, id: string, version: string, options: { update?: boolean } = {}): Promise<CodeVerification> {
  const releaseDir = releaseDirOf(seriesDir, id, version);
  const label = `${id}@${version}`;
  if (options.update) {
    const pinned = pinnedBy(seriesDir, id, version);
    if (pinned.length > 0) fail("release-pinned", `${label} is pinned by ${pinned.join(", ")}: its goldens never change`);
  }
  const { manifest, text: manifestText } = readManifest(releaseDir, label);
  const problems: CodeVerification["problems"] = [];
  const code: { compiler?: any; validator?: any } = {};
  for (const role of ROLES) {
    const bundle = manifest[role]?.bundle as { path: string; hash: string } | undefined;
    if (!bundle) continue;
    const file = join(releaseDir, bundle.path);
    if (!existsSync(file)) {
      problems.push({ code: "missing-code", message: `${bundle.path} is missing` });
      continue;
    }
    const bytes = readFileSync(file);
    if (sha256(bytes) !== bundle.hash) {
      problems.push({ code: "code-mismatch", message: `${bundle.path} is not the code the release sealed` });
      continue;
    }
    if (existsSync(sourceOf(releaseDir, role)) && sha256(await build(releaseDir, role)) !== bundle.hash) {
      problems.push({ code: "source-differs", message: `${role}/index.ts no longer builds to ${bundle.path}: the source changed after sealing` });
    }
    const loaded = releaseCodeOf(role, file, bytes, bundle.hash);
    if (!loaded.ok) problems.push({ code: "bad-code", message: `${bundle.path}: ${loaded.message}` });
    else code[role] = loaded.code;
  }
  if (!manifest.compiler?.bundle && !manifest.validator?.bundle) problems.push({ code: "no-code", message: `${label} names no code of its own` });

  const fixtures: CodeVerification["fixtures"] = [];
  const fixturesDir = join(releaseDir, "fixtures");
  for (const name of existsSync(fixturesDir) ? readdirSync(fixturesDir).sort() : []) {
    const dir = join(fixturesDir, name);
    if (!existsSync(join(dir, "input.json"))) continue;
    const input = JSON.parse(readFileSync(join(dir, "input.json"), "utf-8"));
    // The fixture is compiled as this release, whatever release it was written for.
    input.template = manifest;
    input.spec.template = { id, version, hash: sha256(manifestText) };
    input.code = code;
    const result = compileSpec(input);
    if (!result.ok) {
      fixtures.push({ name, ok: false, message: result.problems.map((p) => `${p.code} at ${p.path}: ${p.message}`).join("; ") });
      continue;
    }
    const errors = checkSeries({ ...input, compiled: result.timeline, timeline: result.timeline }).findings.filter((f) => f.severity === "error");
    if (errors.length > 0) {
      fixtures.push({ name, ok: false, message: `the validator refuses it: ${errors.map((f) => `${f.code} at ${f.path}`).join("; ")}` });
      continue;
    }
    const text = `${JSON.stringify(result.timeline, null, 2)}\n`;
    const golden = join(dir, "expected-timeline.json");
    if (options.update) {
      writeFileSync(golden, text);
      fixtures.push({ name, ok: true, message: "golden written" });
    } else if (!existsSync(golden)) {
      fixtures.push({ name, ok: false, message: "no expected-timeline.json: verify --update writes it" });
    } else if (readFileSync(golden, "utf-8") !== text) {
      fixtures.push({ name, ok: false, message: "compiles differently from its expected-timeline.json" });
    } else {
      fixtures.push({ name, ok: true });
    }
  }
  return { ok: problems.length === 0 && fixtures.every((f) => f.ok), problems, fixtures };
}
