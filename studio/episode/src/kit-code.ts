// ---------------------------------------------------------------------------
// Sealing and verifying a kit a channel or a series carries (avg-d1x)
// ---------------------------------------------------------------------------
// A kit release, library/<channel>/kits/<name>/<version>/ (or the series'
// own kits/), holds its source, kit/index.tsx, exporting `kit` (a
// KitVersion). Sealing builds it into kit.cjs, leaving React, Remotion and
// zod to the application, checks it exports the kit its folder names, and
// writes kit.json with the bundle's hash. A series release pins the kit by
// that kit.json's hash.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isApplicationKit, loadLibraryKit } from "@av/remotion-composer";
import { KIT_BUNDLE, KIT_RELEASE_FILE, KIT_SOURCE, validateKitRelease } from "@studio/contracts/src/kit-releases.mjs";
import { SERIES_TEMPLATE_MANIFEST } from "@studio/contracts/src/layout.mjs";
import { bundleSource, TemplateCodeError } from "./template-code.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/**
 * What a kit draws with that is the application's, never its own copy:
 * React, Remotion, zod, and the composer's toolbox — its frozen libraries,
 * imported by version (`@av/remotion-composer/kits/lib/<name>/<version>`),
 * so a library kit loads the fonts and measures the text as every kit does.
 */
export const KIT_EXTERNALS = ["react", "react-dom", "remotion", "@remotion", "zod", "@av/remotion-composer/kits/lib"];
/** The rest of the composer is the renderer itself: a kit never draws with it. */
const KIT_FORBIDDEN = [{ prefix: "@av/remotion-composer", message: "a kit imports only its kit libraries, @av/remotion-composer/kits/lib/<name>/<version>, never the composer itself" }];

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code: ConstructorParameters<typeof TemplateCodeError>[0], message: string): never => {
  throw new TemplateCodeError(code, message);
};

/** Where a kit release sits: in the channel, or in one of its series. */
export interface KitPlace {
  /** library/<channel>. */
  channelDir: string;
  /** The series' slug, for a series' own kit; absent for the channel's. */
  series?: string;
  name: string;
  version: string;
}

export const kitDirOf = (place: KitPlace) =>
  join(place.series ? join(place.channelDir, "series", place.series) : place.channelDir, "kits", place.name, place.version);

function checkPlace(place: KitPlace): string {
  if (!SLUG.test(place.name)) fail("bad-kit", `"${place.name}" is not a kit name`);
  if (!EXACT.test(place.version)) fail("bad-kit", `"${place.version}" is not an exact x.y.z release`);
  if (place.series !== undefined && !SLUG.test(place.series)) fail("bad-kit", `"${place.series}" is not a series`);
  const dir = kitDirOf(place);
  if (!existsSync(dir)) fail("missing-kit", `${place.name}@${place.version} is not a kit release of ${place.series ? `series ${place.series}` : "the channel"}`);
  return dir;
}

/** The series releases that pin this kit (by name, version and level). */
function kitPinnedBy(place: KitPlace): string[] {
  const pins: string[] = [];
  const seriesRoot = join(place.channelDir, "series");
  const level = place.series ? "series" : "channel";
  for (const series of existsSync(seriesRoot) ? readdirSync(seriesRoot).sort() : []) {
    if (place.series && series !== place.series) continue;
    const templates = join(seriesRoot, series, "templates");
    for (const id of existsSync(templates) ? readdirSync(templates).sort() : []) {
      for (const version of readdirSync(join(templates, id)).sort()) {
        const manifest = join(templates, id, version, SERIES_TEMPLATE_MANIFEST);
        if (!existsSync(manifest)) continue;
        try {
          const kits = JSON.parse(readFileSync(manifest, "utf-8")).kits as { name: string; version: string; level: string }[] | undefined;
          if (kits?.some((k) => k.name === place.name && k.version === place.version && k.level === level)) pins.push(`${series}/${id}@${version}`);
        } catch {
          pins.push(`${series}/${id}@${version} (unreadable)`);
        }
      }
    }
  }
  return pins;
}

/**
 * Build kit/index.tsx into kit.cjs and write kit.json naming it, with its
 * hash. Refused once a series release pins the kit, for a kit that does not
 * export the name@version of its folder, and for an application kit's name@version.
 */
export async function sealKit(place: KitPlace, options: { dryRun?: boolean } = {}): Promise<{ hash: string; bundle: { path: string; hash: string } }> {
  const dir = checkPlace(place);
  const label = `${place.name}@${place.version}`;
  if (isApplicationKit(place.name, place.version)) fail("kit-shadows", `${label} is an application kit: a library kit takes another name or version`);
  const pinned = kitPinnedBy(place);
  if (pinned.length > 0) fail("release-pinned", `${label} is pinned by ${pinned.join(", ")}: a pinned kit never changes; make a new version`);
  if (!existsSync(join(dir, KIT_SOURCE))) fail("no-code", `${label} has no ${KIT_SOURCE}`);
  const text = await bundleSource(dir, KIT_SOURCE, { platform: "neutral", external: KIT_EXTERNALS, forbidden: KIT_FORBIDDEN, jsx: true });
  const bundleHash = sha256(text);
  const loaded = loadLibraryKit(join(dir, KIT_BUNDLE), Buffer.from(text), bundleHash);
  if (!loaded.ok) fail("bad-kit", `${KIT_SOURCE}: ${loaded.message}`);
  const kit = (loaded as { kit: { name: string; version: string } }).kit;
  if (kit.name !== place.name || kit.version !== place.version) fail("bad-kit", `${KIT_SOURCE} exports ${kit.name}@${kit.version}, not the ${label} its folder names`);
  const manifest = { apiVersion: "studio.video/v1alpha1", kind: "KitRelease", name: place.name, version: place.version, bundle: { path: KIT_BUNDLE, hash: bundleHash } };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const result = { hash: sha256(manifestText), bundle: manifest.bundle };
  if (options.dryRun) return result;
  writeFileSync(join(dir, `${KIT_BUNDLE}.tmp`), text);
  renameSync(join(dir, `${KIT_BUNDLE}.tmp`), join(dir, KIT_BUNDLE));
  writeFileSync(join(dir, `${KIT_RELEASE_FILE}.tmp`), manifestText);
  renameSync(join(dir, `${KIT_RELEASE_FILE}.tmp`), join(dir, KIT_RELEASE_FILE));
  return result;
}

export interface KitVerification {
  ok: boolean;
  problems: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
  /** Each example's props held to the kit's own schema. */
  examples: { id: string; ok: boolean; message?: string }[];
}

/** Is the kit's bundle the sealed one, does its source still build to it, and do its examples' props pass its schema? */
export async function verifyKit(place: KitPlace): Promise<KitVerification> {
  const dir = checkPlace(place);
  const problems: KitVerification["problems"] = [];
  const warnings: KitVerification["warnings"] = [];
  const examples: KitVerification["examples"] = [];
  const read = readKitRelease(dir, place);
  if (!read.ok) return { ok: false, problems: [{ code: read.code, message: read.message }], warnings, examples };
  if (existsSync(join(dir, KIT_SOURCE)) && sha256(await bundleSource(dir, KIT_SOURCE, { platform: "neutral", external: KIT_EXTERNALS, forbidden: KIT_FORBIDDEN, jsx: true })) !== read.release.bundle.hash) {
    warnings.push({ code: "rebuild-differs", message: `${KIT_SOURCE} no longer builds to ${KIT_BUNDLE}: its source, or the studio code it inlines, changed since sealing; the sealed bundle is what runs` });
  }
  for (const example of read.kit.examples ?? []) {
    const parsed = read.kit.props.safeParse(example.props);
    examples.push(parsed.success ? { id: example.id, ok: true } : { id: example.id, ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  return { ok: problems.length === 0 && examples.every((e) => e.ok), problems, warnings, examples };
}

/**
 * A sealed kit release, read and checked: kit.json is a KitRelease of its
 * folder's name@version, kit.cjs is the bundle it names, and that bundle
 * exports the kit. What the loader and verifyKit share.
 */
export function readKitRelease(dir: string, place: { name: string; version: string }):
  | { ok: true; manifestText: string; release: { bundle: { path: string; hash: string } }; file: string; bytes: Buffer; kit: import("@av/remotion-composer").KitVersion }
  | { ok: false; code: "missing-kit" | "bad-kit" | "kit-mismatch"; message: string } {
  const label = `${place.name}@${place.version}`;
  const manifestFile = join(dir, KIT_RELEASE_FILE);
  if (!existsSync(manifestFile)) return { ok: false, code: "missing-kit", message: `${label} has no ${KIT_RELEASE_FILE}: seal it (vpr kit seal)` };
  const manifestText = readFileSync(manifestFile, "utf-8");
  let release: any;
  try {
    release = JSON.parse(manifestText);
  } catch (error) {
    return { ok: false, code: "bad-kit", message: `${label}'s ${KIT_RELEASE_FILE} is not JSON: ${(error as Error).message}` };
  }
  const shape = validateKitRelease(release);
  if (shape.length > 0) return { ok: false, code: "bad-kit", message: `${label}'s ${KIT_RELEASE_FILE}: ${shape.map((p) => `${p.path} ${p.message}`).join("; ")}` };
  if (release.name !== place.name || release.version !== place.version) return { ok: false, code: "bad-kit", message: `${KIT_RELEASE_FILE} says ${release.name}@${release.version}, not ${label}` };
  const file = join(dir, KIT_BUNDLE);
  if (!existsSync(file)) return { ok: false, code: "missing-kit", message: `${label}'s ${KIT_BUNDLE} is missing` };
  const bytes = readFileSync(file);
  if (sha256(bytes) !== release.bundle.hash) return { ok: false, code: "kit-mismatch", message: `${label}'s ${KIT_BUNDLE} is not the bundle it sealed: a kit never changes, make a new version` };
  const loaded = loadLibraryKit(file, bytes, release.bundle.hash);
  if (!loaded.ok) return { ok: false, code: "bad-kit", message: `${label}: ${loaded.message}` };
  if (loaded.kit.name !== place.name || loaded.kit.version !== place.version) return { ok: false, code: "bad-kit", message: `${label}'s bundle exports ${loaded.kit.name}@${loaded.kit.version}` };
  return { ok: true, manifestText, release, file, bytes, kit: loaded.kit };
}

/** The kit pins a series release's manifest lists, their hashes filled from the sealed kit releases (for `vpr template seal`). */
export function pinnedKitHashes(seriesDir: string, kits: unknown[]): { name: string; version: string; level: "channel" | "series"; hash: string }[] {
  const channelDir = dirname(dirname(seriesDir));
  const seen = new Set<string>();
  // Each pin's shape before any disk is touched: a name is a folder name, and a level one of two.
  for (const [i, raw] of kits.entries()) {
    const pin = raw as { name?: unknown; version?: unknown; level?: unknown } | null;
    if (!pin || typeof pin !== "object" || typeof pin.name !== "string" || !SLUG.test(pin.name) || typeof pin.version !== "string" || !EXACT.test(pin.version) || (pin.level !== "channel" && pin.level !== "series")) {
      fail("bad-template", `kits[${i}] is not a kit pin: {name, version, level: "channel" | "series"}`);
    }
    const label = `${(pin as { name: string }).name}@${(pin as { version: string }).version}`;
    if (seen.has(label)) fail("bad-template", `${label} is pinned twice: one kit per name@version`);
    seen.add(label);
  }
  return (kits as { name: string; version: string; level: "channel" | "series" }[]).map((pin) => {
    const place: KitPlace = { channelDir, name: pin.name, version: pin.version, ...(pin.level === "series" ? { series: basename(seriesDir) } : {}) };
    const read = readKitRelease(kitDirOf(place), pin);
    if (!read.ok) return fail("bad-template", `the release pins ${pin.level} kit ${pin.name}@${pin.version}: ${read.message}`);
    if (isApplicationKit(pin.name, pin.version)) fail("bad-template", `${pin.name}@${pin.version} is an application kit: a release pins only library kits`);
    return { name: pin.name, version: pin.version, level: pin.level, hash: sha256((read as { manifestText: string }).manifestText) };
  });
}
