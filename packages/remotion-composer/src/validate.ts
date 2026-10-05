// Composer-level validation: the timeline's structure (zod mirror) and, for
// every visual item, a registered kit at that version with valid props.
// Semantic rules (overlaps, references) belong to the contracts'
// validateEditTimeline, which the caller runs first (ADR-0034).

import type {ZodIssue} from 'zod';
import {KITS} from './kits/registry.js';
import {EditTimelineSchema, isAudioItem, type EditTimeline} from './schema.js';
import type {ComposerProblem} from './errors.js';

const member = (key: string | number) =>
  typeof key === 'number' ? `[${key}]` : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
const pathOf = (base: string, issue: ZodIssue) => base + issue.path.map(member).join('');

export function validateTimeline(doc: unknown): {ok: true; timeline: EditTimeline} | {ok: false; problems: ComposerProblem[]} {
  const parsed = EditTimelineSchema.safeParse(doc);
  if (!parsed.success) {
    return {ok: false, problems: parsed.error.issues.map((i) => ({code: 'invalid-timeline' as const, message: i.message, path: pathOf('$', i)}))};
  }
  const timeline = parsed.data;
  const problems: ComposerProblem[] = [];
  timeline.tracks.forEach((track, ti) =>
    track.items.forEach((item, ii) => {
      if (isAudioItem(item)) return;
      const p = `$.tracks[${ti}].items[${ii}]`;
      const kit = KITS[item.kit.name];
      if (!kit || kit.version !== item.kit.version) {
        const known = kit ? `${item.kit.name} is ${kit.version} here` : `no kit "${item.kit.name}"`;
        problems.push({code: 'unknown-kit', message: `${item.kit.name}@${item.kit.version}: ${known}`, path: `${p}.kit`});
        return;
      }
      const props = kit.props.safeParse(item.props);
      if (!props.success) {
        for (const issue of props.error.issues) {
          problems.push({code: 'bad-props', message: `${item.kit.name}: ${issue.message}`, path: pathOf(`${p}.props`, issue)});
        }
      }
    }),
  );
  return problems.length > 0 ? {ok: false, problems} : {ok: true, timeline};
}
