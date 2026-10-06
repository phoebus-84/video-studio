// Composer-level validation: the timeline's structure (zod mirror) and, for
// every visual item, a registered kit at that version with valid props.
// Semantic rules (overlaps, references) belong to the contracts'
// validateEditTimeline, which the caller runs first (ADR-0034).

import type {ZodIssue} from 'zod';
import {kitVersions, resolveKit} from './kits/index.js';
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
  const {profile, resolution} = timeline;
  if (profile.width !== resolution.width || profile.height !== resolution.height) {
    problems.push({
      code: 'invalid-timeline',
      message: `resolution ${resolution.width}x${resolution.height} is not profile "${profile.id}" (${profile.width}x${profile.height})`,
      path: '$.profile',
    });
  }
  // The contracts' profile-safe-zone rule, re-checked: kits must have room to draw.
  const zone = profile.safeZone;
  if (zone.top + zone.bottom >= profile.height) {
    problems.push({
      code: 'invalid-timeline',
      message: `profile "${profile.id}": safe zone top ${zone.top} + bottom ${zone.bottom} leaves nothing of height ${profile.height}`,
      path: '$.profile.safeZone',
    });
  }
  if (zone.left + zone.right >= profile.width) {
    problems.push({
      code: 'invalid-timeline',
      message: `profile "${profile.id}": safe zone left ${zone.left} + right ${zone.right} leaves nothing of width ${profile.width}`,
      path: '$.profile.safeZone',
    });
  }
  timeline.tracks.forEach((track, ti) =>
    track.items.forEach((item, ii) => {
      if (isAudioItem(item)) return;
      const p = `$.tracks[${ti}].items[${ii}]`;
      const kit = resolveKit(item.kit.name, item.kit.version);
      if (!kit) {
        const versions = kitVersions(item.kit.name);
        const known = versions.length > 0 ? `available ${versions.map((v) => `${item.kit.name}@${v}`).join(', ')}` : `no kit "${item.kit.name}"`;
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
