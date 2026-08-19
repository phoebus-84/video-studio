/**
 * Reading a pipeline manifest well enough to draw it.
 *
 * This is not a YAML parser and must not become one. It recognises exactly the
 * shape a pipeline manifest uses for its stage list:
 *
 *     stages:
 *       - id: illustrations
 *         capability: image.generate
 *         provider: fal.ai/flux-1.1-pro
 *
 * The studio needs this to show the series' pipeline as a chain of stages
 * without shipping a YAML dependency to render five nouns. Anything it does not
 * recognise it reports as unparsed rather than guessing, so a manifest that
 * outgrows this shape shows up as "cannot draw this" instead of as a wrong
 * diagram — which is the failure that would actually mislead someone.
 */

export interface ManifestStage {
  id: string;
  capability: string | null;
  provider: string | null;
}

export interface ParsedManifest {
  /** The pipeline this manifest names, when it names one. */
  name: string | null;
  stages: ManifestStage[];
  /** True when a `stages:` block was found at all. */
  recognised: boolean;
}

const STAGES_KEY = /^stages:\s*$/;
const ITEM = /^(\s*)-\s+id:\s*(.+?)\s*$/;
const FIELD = /^(\s*)([\w.-]+):\s*(.*?)\s*$/;
/** A new top-level key ends the stage block. */
const TOP_LEVEL = /^[\w.-]+:/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const PIPELINE_NAME = /^pipeline:\s*(.+?)\s*$/;

export function parsePipelineManifest(source: string): ParsedManifest {
  const lines = source.split(/\r?\n/);

  /* A series manifest often names a pipeline rather than spelling its stages
     out — the chain is then defined wherever that pipeline lives. Reporting the
     name is more useful than reporting nothing. */
  const named = lines.map((l) => PIPELINE_NAME.exec(l)).find((m) => m !== null);
  const name = named ? unquote(named[1]!) : null;

  let i = lines.findIndex((line) => STAGES_KEY.test(line));
  if (i === -1) return { name, stages: [], recognised: false };

  const stages: ManifestStage[] = [];
  let current: ManifestStage | null = null;
  let itemIndent = -1;

  for (i += 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    /* Dedent back to column zero means the stage list is over. */
    if (TOP_LEVEL.test(line)) break;

    const item = ITEM.exec(line);
    if (item) {
      if (current) stages.push(current);
      itemIndent = item[1]!.length;
      current = { id: unquote(item[2]!), capability: null, provider: null };
      continue;
    }

    const field = FIELD.exec(line);
    /* Only fields nested under the current item belong to it. */
    if (field && current && field[1]!.length > itemIndent) {
      const key = field[2]!;
      const value = unquote(field[3]!);
      if (key === "capability") current.capability = value || null;
      else if (key === "provider") current.provider = value || null;
    }
  }

  if (current) stages.push(current);

  return { name, stages, recognised: true };
}
