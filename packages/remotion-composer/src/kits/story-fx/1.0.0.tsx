// story-fx@1.0.0 — released: never edit this file; add story-fx/<next>.tsx instead.
// The effects a lesson's story scenes draw over the panel (from CreativeStudio's
// poesie-museo-long story engine): a row of people lighting up (how many in
// ten), an arrow that curves out to its point, a round badge, a live bolt that
// strikes, a line of light. Positions are inside the panel box. Channel-neutral:
// the look is a prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {COLOR_ROLES, DEMO_LOOK, LookSchema, alpha, type ColorRole, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {clamp, ramp} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {LiveBolt, boltPoints, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {LightLine, SvgText, ptsPath} from '../lib/lesson-tools/1.0.0.js';

type Effect =
  | {people: {at: number; total?: number; lit?: number; extra?: {at: number}; x0?: number; y?: number; step?: number}}
  | {arc: {at: number; path: [number, number, number, number, number, number]; color?: ColorRole}}
  | {badge: {text: string; x: number; y: number}}
  | {bolt: {strikes: number[]; path?: [number, number, number, number]; seed?: number}}
  | {lightline: {at: number; until: number; path?: [number, number, number, number]}};

const StoryFx: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? {x: 440, y: 150, w: 1060, h: 596};
  const draw = (e: Effect, key: number): React.ReactNode => {
    if ('people' in e) {
      const f = e.people;
      const total = f.total ?? 10;
      const lit = f.lit ?? 5;
      return (
        <g key={key}>
          {Array.from({length: total}, (_, j) => {
            const on = ramp(t, f.at - 0.2 + j * 0.07, f.at + 0.05 + j * 0.07);
            const isLit = j < lit || (f.extra !== undefined && j === lit && t > f.extra.at);
            const cx = P.x + (f.x0 ?? 134) + j * (f.step ?? 88);
            const cy = P.y + (f.y ?? 300);
            const fill = isLit ? c.highlight : alpha(c.text, 0.75);
            return <g key={j} opacity={on}><circle cx={cx} cy={cy - 48} r={22} fill={fill} /><rect x={cx - 28} y={cy - 20} width={56} height={90} rx={24} fill={fill} /></g>;
          })}
        </g>
      );
    }
    if ('arc' in e) {
      const k = clamp((t - e.arc.at) / 1.2);
      const [x0, y0, cx, cy, x1, y1] = e.arc.path;
      const color = c[e.arc.color ?? 'highlight'];
      if (k <= 0) return null;
      const angle = Math.atan2(y1 - cy, x1 - cx);
      const head = [[x1, y1], [x1 - 22 * Math.cos(angle - 0.45), y1 - 22 * Math.sin(angle - 0.45)], [x1 - 22 * Math.cos(angle + 0.45), y1 - 22 * Math.sin(angle + 0.45)]].map(([x, y]) => `${P.x + x!},${P.y + y!}`).join(' ');
      return (
        <g key={key} opacity={k}>
          <path d={`M${P.x + x0} ${P.y + y0} Q${P.x + cx} ${P.y + cy} ${P.x + x1} ${P.y + y1}`} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - k} />
          {k > 0.95 ? <polygon points={head} fill={color} /> : null}
        </g>
      );
    }
    if ('badge' in e) {
      const cx = P.x + e.badge.x;
      const cy = P.y + e.badge.y;
      return (
        <g key={key}>
          <circle cx={cx} cy={cy} r={62} fill={alpha(c.plate, 0.8)} stroke={alpha(c.text, 0.7)} />
          <SvgText look={look} fonts={fonts} x={cx} y={cy + 22} size={60} anchor="middle" weight={200}>{e.badge.text}</SvgText>
        </g>
      );
    }
    if ('bolt' in e) {
      const [x0, y0, x1, y1] = e.bolt.path ?? [820, 10, 760, 420];
      return <LiveBolt key={key} look={look} t={t} x0={P.x + x0} y0={P.y + y0} x1={P.x + x1} y1={P.y + y1} op={e.bolt.strikes.reduce((m, a) => m + strikeAt(t, [a]), 0)} seed={e.bolt.seed ?? 9} grow={1} />;
    }
    const [x0, y0, x1, y1] = e.lightline.path ?? [880, 20, 840, P.h - 30];
    const op = strikeAt(t, [e.lightline.at]) + 0.25 * ramp(t, e.lightline.at + 0.05, e.lightline.at + 0.45) * (1 - ramp(t, e.lightline.until, e.lightline.until + 0.5));
    return <LightLine key={key} look={look} d={ptsPath(boltPoints(P.x + x0, P.y + y0, P.x + x1, P.y + y1, 11, 5, 120))} op={op} width={4} />;
  };
  return <AbsoluteFill><svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>{(props.effects as Effect[]).map(draw)}</svg></AbsoluteFill>;
};

const Path4 = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const EffectSchema = z.union([
  z.object({people: z.object({at: z.number(), total: z.number().int().min(1).max(14).optional(), lit: z.number().int().min(0).optional(), extra: z.object({at: z.number()}).strict().optional(), x0: z.number().optional(), y: z.number().optional(), step: z.number().positive().optional()}).strict()}).strict(),
  z.object({arc: z.object({at: z.number(), path: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]), color: z.enum(COLOR_ROLES).optional()}).strict()}).strict(),
  z.object({badge: z.object({text: z.string().min(1).max(4), x: z.number(), y: z.number()}).strict()}).strict(),
  z.object({bolt: z.object({strikes: z.array(z.number()).min(1), path: Path4.optional(), seed: z.number().int().optional()}).strict()}).strict(),
  z.object({lightline: z.object({at: z.number(), until: z.number(), path: Path4.optional()}).strict()}).strict(),
]);

export const kit: KitVersion = {
  name: 'story-fx',
  version: '1.0.0',
  description: "The effects of a lesson's story scenes over the 16:9 panel — people lighting up, a curving arrow, a badge, a striking bolt, a line of light — in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** The panel the effects are placed in (default 440/150/1060×596). */
    box: BoxSchema.optional(),
    effects: z.array(EffectSchema).min(1).max(8),
  }).strict(),
  component: StoryFx,
  examples: [
    {id: 'people', props: {look: DEMO_LOOK, effects: [{people: {at: 0, lit: 5, extra: {at: 1.5}}}]}, durationInFrames: 90, frame: 60},
    {id: 'arc-and-badge', props: {look: DEMO_LOOK, effects: [{arc: {at: 0, path: [120, 420, 500, 80, 900, 380]}}, {badge: {text: '11', x: 530, y: 290}}]}, durationInFrames: 60, frame: 45},
    {id: 'bolt-and-line', props: {look: DEMO_LOOK, effects: [{bolt: {strikes: [0.5]}}, {lightline: {at: 0.2, until: 3}}]}, durationInFrames: 60, frame: 18},
  ],
};
