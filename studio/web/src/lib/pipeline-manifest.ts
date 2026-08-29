/**
 * Reading a pipeline manifest well enough to draw it.
 *
 * This is not a YAML parser and must not become one. It recognises the shape a
 * pipeline manifest uses for its stage list, which appears at the top level:
 *
 *     stages:
 *       - id: illustrations
 *         capability: image.generate
 *         provider: fal.ai/flux-1.1-pro
 *
 * and, in every definition this project actually writes, nested inside the
 * `pipeline:` block:
 *
 *     pipeline:
 *       id: narrated-illustrated-video
 *       stages:
 *         - id: brief
 *           type: editorial
 *
 * The second form used to find nothing. `stages:` was matched anchored to
 * column zero, so a manifest that nests it -- which is all of them -- parsed as
 * having no stage list, and the studio told you a fifteen-stage pipeline was
 * "still valid, it is just not a pipeline definition". The graph pane has never
 * drawn a chain for any file in this repository. The tests did not catch it
 * because their fixtures were written to the parser rather than taken from the
 * manifests, so both agreed on a shape nothing on disk uses.
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
  /** The stage's kind, for manifests that classify rather than bind. */
  type: string | null;
}

export interface ParsedManifest {
  /** The pipeline this manifest names, when it names one. */
  name: string | null;
  stages: ManifestStage[];
  /** True when a `stages:` block was found at all. */
  recognised: boolean;
}

/** `stages:` opening a block, at whatever depth it sits. */
const STAGES_KEY = /^(\s*)stages:\s*$/;
const ITEM = /^(\s*)-\s+id:\s*(.+?)\s*$/;
const FIELD = /^(\s*)([\w.-]+):\s*(.*?)\s*$/;
/** A binding names its pipeline inline: `pipeline: narrated-illustrated-video`. */
const PIPELINE_NAME = /^pipeline:\s*(.+?)\s*$/;
/** A definition opens a block instead, and names itself with an `id` inside it. */
const PIPELINE_BLOCK = /^pipeline:\s*$/;

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

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function skippable(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

/**
 * The pipeline this manifest is about.
 *
 * A binding says `pipeline: some-name` on one line. A definition opens a
 * `pipeline:` block and puts its `id` inside, which is the same fact written
 * the other way round — reporting only the first left every definition
 * anonymous in a header whose job is to name it.
 */
function readName(lines: string[]): string | null {
  for (const [index, line] of lines.entries()) {
    const inline = PIPELINE_NAME.exec(line);
    if (inline) return unquote(inline[1]!);

    if (!PIPELINE_BLOCK.test(line)) continue;
    for (let i = index + 1; i < lines.length; i++) {
      const next = lines[i]!;
      if (skippable(next)) continue;
      // Back at column zero: the block closed without naming itself.
      if (indentOf(next) === 0) break;
      const field = FIELD.exec(next);
      if (field && field[2] === "id") return unquote(field[3]!);
    }
  }
  return null;
}

export function parsePipelineManifest(source: string): ParsedManifest {
  const lines = source.split(/\r?\n/);

  /* A series manifest often names a pipeline rather than spelling its stages
     out — the chain is then defined wherever that pipeline lives. Reporting the
     name is more useful than reporting nothing. */
  const name = readName(lines);

  let i = lines.findIndex((line) => STAGES_KEY.test(line));
  if (i === -1) return { name, stages: [], recognised: false };

  /* The block ends where the indentation returns to the `stages:` key itself.
     Testing for column zero only worked while the key was there too. */
  const blockIndent = indentOf(lines[i]!);

  const stages: ManifestStage[] = [];
  let current: ManifestStage | null = null;
  let itemIndent = -1;
  /* The depth of a stage's own fields, learnt from the first one seen. A stage
     nests blocks of its own — `outputs:`, `gates:` — and anything inside those
     describes an output or a gate, not the stage. Accepting every field deeper
     than the item would let a `type:` belonging to something else overwrite the
     stage's. */
  let fieldIndent = -1;

  for (i += 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (skippable(line)) continue;

    if (indentOf(line) <= blockIndent) break;

    const item = ITEM.exec(line);
    if (item) {
      if (current) stages.push(current);
      itemIndent = item[1]!.length;
      fieldIndent = -1;
      current = { id: unquote(item[2]!), capability: null, provider: null, type: null };
      continue;
    }

    const field = FIELD.exec(line);
    if (!field || !current) continue;
    const depth = field[1]!.length;
    if (depth <= itemIndent) continue;
    if (fieldIndent === -1) fieldIndent = depth;
    if (depth !== fieldIndent) continue;

    const key = field[2]!;
    const value = unquote(field[3]!);
    if (key === "capability") current.capability = value || null;
    else if (key === "provider") current.provider = value || null;
    else if (key === "type") current.type = value || null;
  }

  if (current) stages.push(current);

  return { name, stages, recognised: true };
}
