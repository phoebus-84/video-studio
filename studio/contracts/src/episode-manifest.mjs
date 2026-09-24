/**
 * The episode manifest as it exists on disk.
 *
 * Rendering lives here rather than in either creator because both write this
 * file, and two string templates producing "the same" YAML is exactly the
 * duplication this module exists to remove.
 *
 * Only rendering. Parsing needs a YAML library and this package has no runtime
 * dependencies; whoever reads the file brings their own parser.
 */

/** The manifest's filename, relative to the episode directory. */
export const EPISODE_MANIFEST_FILE = "episode.yaml";

/**
 * Render an episode manifest.
 *
 * A field whose value is absent is omitted from the document entirely. It is
 * never written empty: a manifest claiming `createdAt: ""` asserts a fact
 * nobody holds, and this file's whole purpose is to be authoritative.
 *
 * Scalars are emitted as JSON strings, which are valid double-quoted YAML
 * scalars. That is what keeps a colon in a title from ending the document.
 */
export function renderEpisodeManifest(fields) {
  const { slug, channel, series, title, description, createdAt } = fields ?? {};
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error("an episode manifest must name its slug");
  }
  const lines = [
    "# Episode manifest. See docs/workspace.md.",
    "apiVersion: studio.video/v1alpha1",
    "kind: Episode",
    `slug: ${JSON.stringify(slug)}`,
  ];
  const optional = { channel, series, title, description, createdAt };
  for (const [key, value] of Object.entries(optional)) {
    if (typeof value === "string" && value.length > 0) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
