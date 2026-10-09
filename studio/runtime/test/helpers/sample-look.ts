// A channel's look and a series release pinned to it, laid out for the
// release tests (ADR-0040): the contracts' sample theme (one room, its
// picture written here) and their example poetry-short release, pinning that
// theme, at library/sample/series/poetry/templates/poetry-short/1.0.0.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const THEME = dirname(require.resolve("@studio/contracts/fixtures/channel-theme/sample/themes/sample/1.0.0/theme.json"));
const RELEASE = dirname(require.resolve("@studio/contracts/fixtures/series-template/example/templates/poetry-short/1.0.0/series-template.json"));
const sha = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function layOutSampleLook(root: string): void {
  const themeDir = join(root, "sample", "themes", "sample", "1.0.0");
  cpSync(THEME, themeDir, { recursive: true });
  mkdirSync(join(themeDir, "rooms"), { recursive: true });
  writeFileSync(join(themeDir, "rooms", "hall.png"), "a hall");
  const releaseDir = join(root, "sample", "series", "poetry", "templates", "poetry-short", "1.0.0");
  cpSync(RELEASE, releaseDir, { recursive: true });
  const manifestFile = join(releaseDir, "series-template.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
  manifest.theme = { id: "sample", version: "1.0.0", hash: sha(readFileSync(join(themeDir, "theme.json"))) };
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}
