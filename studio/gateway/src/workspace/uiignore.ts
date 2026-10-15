// ---------------------------------------------------------------------------
// What the studio leaves out of a file listing: .uiignore
// ---------------------------------------------------------------------------
// A channel is a repository with code in it (ADR-0041 to ADR-0045), so its
// tree holds files nobody opens in the studio: lock files, node_modules/,
// caches, backups. The listing leaves them out unless asked to show
// everything, and says how many it left out.
//
// The rules have .gitignore's syntax and are read in layers, each able to add
// patterns or bring a file back with `!pattern`:
//   1. DEFAULT_UIIGNORE, below;
//   2. a `.uiignore` in the channel's folder;
//   3. a `.uiignore` in the series' folder, and in any folder below, each
//      applying to its own folder and what is inside it.
// A later layer wins, as a deeper .gitignore does. A folder left out is not
// opened, so nothing inside it can come back (as with git).
//
// Only the listing reads this. Nothing is hidden from the agent, the runtime
// or a file route: a path still opens when asked for by name.
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ignore, { type Ignore } from "ignore";

export const UIIGNORE_FILE = ".uiignore";

/** What every listing leaves out unless a .uiignore brings it back. */
export const DEFAULT_UIIGNORE: readonly string[] = [
  "# Version control, and what tools make for themselves",
  ".git/",
  "node_modules/",
  ".cache/",
  "*.tmp",
  "*.bak.json",
  "*.tsbuildinfo",
  "Thumbs.db",
  "# Lock files: written by tools, for tools",
  "*.lock",
  "*.lockb",
  "*.lock.json",
  "*.lock.jsonl",
  "package-lock.json",
  "pnpm-lock.yaml",
];

interface Layer {
  /** Absolute folder the patterns are relative to. */
  base: string;
  matcher: Ignore;
}

/** Forward-slashed path of `abs` relative to `base`, or null when outside it. */
function relativeTo(base: string, abs: string): string | null {
  const rel = path.relative(base, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

async function readLayer(dir: string): Promise<Layer | null> {
  let text: string;
  try {
    text = await fs.readFile(path.join(dir, UIIGNORE_FILE), "utf-8");
  } catch {
    return null;
  }
  return { base: dir, matcher: ignore().add(text) };
}

export class UiIgnore {
  private constructor(
    private readonly layers: readonly Layer[],
    /** Set when a folder above this one is itself left out. */
    readonly inherited: boolean,
  ) {}

  /**
   * The rules in force inside `dir`: the defaults, then every .uiignore from
   * the channel's folder down to `dir`. `dir` must be the channel's folder or
   * inside it.
   */
  static async forDirectory(channelDir: string, dir: string): Promise<UiIgnore> {
    let rules = new UiIgnore([{ base: channelDir, matcher: ignore().add([...DEFAULT_UIIGNORE]) }], false);
    rules = await rules.enter(channelDir);
    const rel = relativeTo(channelDir, dir);
    if (rel === null) return rules;
    let current = channelDir;
    for (const segment of rel.split("/")) {
      current = path.join(current, segment);
      rules = await rules.enter(current, rules.isIgnored(current, true));
    }
    return rules;
  }

  /** The rules inside a subfolder: these plus its own .uiignore. */
  async enter(dir: string, ignoredHere = false): Promise<UiIgnore> {
    const layer = await readLayer(dir);
    const inherited = this.inherited || ignoredHere;
    return layer ? new UiIgnore([...this.layers, layer], inherited) : new UiIgnore(this.layers, inherited);
  }

  /** Whether the listing leaves `abs` out. */
  isIgnored(abs: string, isDirectory: boolean): boolean {
    if (this.inherited) return true;
    let ignored = false;
    for (const layer of this.layers) {
      const rel = relativeTo(layer.base, abs);
      if (rel === null) continue;
      const verdict = layer.matcher.test(isDirectory ? `${rel}/` : rel);
      if (verdict.ignored) ignored = true;
      else if (verdict.unignored) ignored = false;
    }
    return ignored;
  }
}
