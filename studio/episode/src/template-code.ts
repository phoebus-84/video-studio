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
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { compileSpec, checkSeries } from "@studio/series";
import { SERIES_TEMPLATE_MANIFEST } from "@studio/contracts/src/layout.mjs";
import { SERIES_TEMPLATE_FILES, validateSeriesTemplate, validateTemplateBundle } from "@studio/contracts/src/series-templates.mjs";
import { releaseCodeOf } from "./release-code.js";
import { pinnedKitHashes } from "./kit-code.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ROLES = ["compiler", "validator"] as const;
type Role = (typeof ROLES)[number];

export type TemplateCodeCode =
  | "missing-template" | "bad-template" | "release-pinned" | "build-failed" | "bad-code" | "no-code" | "no-esbuild"
  // A kit's (avg-d1x, phase 2).
  | "missing-kit" | "bad-kit" | "kit-shadows";

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

/**
 * What pins the release: the series' episodes whose spec names it, and its
 * golden references. A spec or reference that cannot be read counts as a pin:
 * sealing must never guess that nothing depends on a release.
 */
function pinnedBy(seriesDir: string, id: string, version: string): string[] {
  const pins: string[] = [];
  const names = (file: string, label: string) => {
    try {
      const doc = JSON.parse(readFileSync(file, "utf-8"));
      if (doc?.template?.id === id && doc?.template?.version === version) pins.push(label);
    } catch {
      pins.push(`${label} (unreadable)`);
    }
  };
  const episodes = join(seriesDir, "episodes");
  for (const name of existsSync(episodes) ? readdirSync(episodes).sort() : []) {
    if (existsSync(join(episodes, name, "episode-spec.json"))) names(join(episodes, name, "episode-spec.json"), name);
  }
  const references = join(seriesDir, "templates", id, "references");
  for (const name of existsSync(references) ? readdirSync(references).filter((n) => n.endsWith(".json") && !n.endsWith(".withdrawal.json")).sort() : []) {
    names(join(references, name), `reference ${name.slice(0, -5)}`);
  }
  return pins;
}

const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", ".cjs", ".json", "/index.ts", "/index.tsx", "/index.mjs", "/index.js"];
const LOADERS: Record<string, "ts" | "tsx" | "js" | "json"> = { ".ts": "ts", ".tsx": "tsx", ".mjs": "js", ".js": "js", ".cjs": "js", ".json": "json" };

/** The first file a relative import names, trying the usual extensions. */
function fileOf(base: string): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** `<name>@<version>/<path in the package>` for a file of the app: the same wherever the app is installed. */
function packageKeyOf(file: string, cache: Map<string, string>): string {
  let dir = dirname(file);
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      let key = cache.get(dir);
      if (key === undefined) {
        const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as { name?: string; version?: string };
        key = pkg.name ? `${pkg.name}@${pkg.version ?? "0.0.0"}` : "";
        cache.set(dir, key);
      }
      if (key) return `${key}/${relative(dir, file).split(sep).join("/")}`;
    }
    const up = dirname(dir);
    if (up === dir) return relative(process.cwd(), file).split(sep).join("/");
    dir = up;
  }
}

/**
 * One self-contained CommonJS bundle of a role's source. Every module is
 * named by where it sits in the release (`release:compiler/x.ts`) or in its
 * package (`app:@studio/contracts@0.1.0/src/cues.mjs`), never by a path on
 * this machine, so the bundle is the same wherever the library and the app
 * are. Bare imports resolve as Node would from the app; relative ones stay
 * inside the release.
 */
async function build(releaseDir: string, role: Role): Promise<string> {
  return bundleSource(releaseDir, `${role}/index.ts`, { platform: "node" });
}

/**
 * Bundle `entry` (relative to `root`) into one CommonJS file: the same
 * wherever `root` and the app are. `external` packages stay `require`s (a
 * kit's React, Remotion and zod: the application's own); `jsx` compiles TSX
 * for React's automatic runtime.
 */
export async function bundleSource(root: string, entry: string, options: { platform: "node" | "neutral"; external?: string[]; jsx?: boolean }): Promise<string> {
  const releaseDir = root;
  const external = options.external ?? [];
  const require = createRequire(import.meta.url);
  let esbuild: typeof import("esbuild");
  try {
    esbuild = require("esbuild");
  } catch {
    return fail("no-esbuild", "esbuild is not installed beside the studio: it builds a release's code");
  }
  const real = new Map<string, string>(); // "<namespace>:<key>" → file
  const packages = new Map<string, string>();
  const builtins = new Set(builtinModules);
  const name = (namespace: "release" | "app", file: string) => {
    const key = namespace === "release" ? relative(releaseDir, file).split(sep).join("/") : packageKeyOf(file, packages);
    real.set(`${namespace}:${key}`, file);
    return { path: key, namespace };
  };
  const plugin: import("esbuild").Plugin = {
    name: "release-code",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return name("release", join(releaseDir, entry));
        if (args.path.startsWith("node:") || builtins.has(args.path) || builtins.has(args.path.split("/")[0]!)) return { path: args.path, external: true };
        if (external.some((e) => args.path === e || args.path.startsWith(`${e}/`))) return { path: args.path, external: true };
        const importer = real.get(`${args.namespace}:${args.importer}`);
        if (!importer) return { errors: [{ text: `cannot place ${args.path}: its importer ${args.importer} is unknown` }] };
        if (args.path.startsWith(".")) {
          const file = fileOf(resolve(dirname(importer), args.path));
          if (!file) return { errors: [{ text: `${args.path} not found from ${args.importer}` }] };
          if (args.namespace === "release") {
            const inside = relative(releaseDir, file);
            if (inside.startsWith("..") || isAbsolute(inside)) return { errors: [{ text: `${args.path} leads outside the release` }] };
            return name("release", file);
          }
          return name("app", file);
        }
        // A bare import: the release's from the app, the app's from where it sits.
        const from = args.namespace === "release" ? fileURLToPath(import.meta.url) : importer;
        try {
          return name("app", createRequire(from).resolve(args.path));
        } catch {
          return { errors: [{ text: `${args.path} is not a package the studio has (imported by ${args.importer})` }] };
        }
      });
      b.onLoad({ filter: /.*/ }, (args) => {
        const file = real.get(`${args.namespace}:${args.path}`)!;
        return { contents: readFileSync(file), loader: LOADERS[extname(file)] ?? "js", resolveDir: dirname(file) };
      });
    },
  };
  try {
    const out = await esbuild.build({
      entryPoints: [entry],
      absWorkingDir: releaseDir,
      bundle: true,
      platform: options.platform,
      ...(options.jsx ? { jsx: "automatic" as const } : {}),
      format: "cjs",
      target: "node20",
      write: false,
      plugins: [plugin],
      // No tsconfig above the release changes how it builds.
      tsconfigRaw: "{}",
      minifyWhitespace: true,
      legalComments: "none",
      logLevel: "silent",
    });
    return out.outputFiles[0]!.text;
  } catch (error) {    const errors = (error as { errors?: { text: string; location?: { file: string; line: number } }[] }).errors ?? [];
    const detail = errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ""}${e.text}`).join("; ");
    return fail("build-failed", `${entry} does not build: ${detail || (error as Error).message}`);
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
    const hash = sha256(built[role]!);
    // Sealed only if it runs as what the release names it.
    const loaded = releaseCodeOf(role, join(releaseDir, bundlePath(role)), Buffer.from(built[role]!), hash, manifest[role]);
    if (!loaded.ok) fail("bad-code", `${role}/index.ts: ${loaded.message}`);
    manifest[role] = { id: manifest[role].id, version: manifest[role].version, bundle: { path: bundlePath(role), hash } };
  }
  // The library kits it pins (avg-d1x): each sealed, its kit.json's hash filled in.
  if (Array.isArray(manifest.kits)) manifest.kits = pinnedKitHashes(seriesDir, manifest.kits);
  if (Object.keys(built).length === 0 && !manifest.kits?.length) fail("no-code", `${label} has neither compiler/index.ts nor validator/index.ts, and pins no kits`);

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
  /** Worth knowing, not wrong: e.g. the source, or the toolbox it inlines, no longer builds to the sealed bundle. */
  warnings: { code: string; message: string }[];
  fixtures: { name: string; ok: boolean; message?: string }[];
}

/**
 * Is the release's code the sealed code, does its source still build to it,
 * and do its fixtures (fixtures/<name>/input.json) compile to their golden
 * timelines (expected-timeline.json)? `update` writes the goldens instead,
 * refused once an episode pins the release.
 */
export async function verifyTemplateCode(seriesDir: string, id: string, version: string, options: { update?: boolean; dryRun?: boolean } = {}): Promise<CodeVerification> {
  const releaseDir = releaseDirOf(seriesDir, id, version);
  const label = `${id}@${version}`;
  if (options.update && !options.dryRun) {
    const pinned = pinnedBy(seriesDir, id, version);
    if (pinned.length > 0) fail("release-pinned", `${label} is pinned by ${pinned.join(", ")}: its goldens never change`);
  }
  const { manifest, text: manifestText } = readManifest(releaseDir, label);
  // The manifest's shape first: a bundle path is only read once the contract has held it to compiler/ or validator/.
  const shape = validateSeriesTemplate(manifest);
  if (shape.length > 0) fail("bad-template", shape.map((p: { code: string; path: string; message: string }) => `${p.code} at ${p.path}: ${p.message}`).join("; "));
  const problems: CodeVerification["problems"] = [];
  const warnings: CodeVerification["warnings"] = [];
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
      warnings.push({ code: "rebuild-differs", message: `${role}/index.ts no longer builds to ${bundle.path}: its source, or the studio code it inlines, changed since sealing; the sealed bundle is what runs` });
    }
    const loaded = releaseCodeOf(role, file, bytes, bundle.hash, manifest[role]);
    if (!loaded.ok) problems.push({ code: "bad-code", message: `${bundle.path}: ${loaded.message}` });
    else code[role] = loaded.code;
  }
  if (!manifest.compiler?.bundle && !manifest.validator?.bundle) problems.push({ code: "no-code", message: `${label} names no code of its own` });

  const fixtures: CodeVerification["fixtures"] = [];
  const fixturesDir = join(releaseDir, "fixtures");
  for (const name of existsSync(fixturesDir) ? readdirSync(fixturesDir).sort() : []) {
    const dir = join(fixturesDir, name);
    if (!statSync(dir).isDirectory()) continue;
    let input: any;
    try {
      input = JSON.parse(readFileSync(join(dir, "input.json"), "utf-8"));
      if (input === null || typeof input !== "object" || typeof input.spec !== "object" || input.spec === null) throw new Error("not a compile input (no spec)");
    } catch (error) {
      fixtures.push({ name, ok: false, message: `input.json: ${existsSync(join(dir, "input.json")) ? (error as Error).message : "missing"}` });
      continue;
    }
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
      if (!options.dryRun) writeFileSync(golden, text);
      fixtures.push({ name, ok: true, message: options.dryRun ? "golden would be written" : "golden written" });
    } else if (!existsSync(golden)) {
      fixtures.push({ name, ok: false, message: "no expected-timeline.json: verify --update writes it" });
    } else if (readFileSync(golden, "utf-8") !== text) {
      fixtures.push({ name, ok: false, message: "compiles differently from its expected-timeline.json" });
    } else {
      fixtures.push({ name, ok: true });
    }
  }
  return { ok: problems.length === 0 && fixtures.every((f) => f.ok), problems, warnings, fixtures };
}
