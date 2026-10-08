// progress@1.0.0 — released: never edit this file; add progress/<next>.tsx instead.
// Where a lesson is among its pictures (from CreativeStudio's poesie-museo-long
// specimens): a plate above the panel with one segment per picture — finished
// ones show their keyword, the current one is in the accent colour, the rest
// show their number. Channel-neutral: the look is a prop (ADR-0040).
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {SvgText} from '../lib/lesson-tools/1.0.0.js';
import type {Box} from '../lib/lesson-stage/1.0.0.js';

const Progress: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const P = (props.box as Box | undefined) ?? {x: 440, y: 150, w: 1060, h: 596};
  const steps = props.steps as {label: string}[];
  const current = props.current as number;
  const done = props.done as number;
  const seg = P.w / steps.length;
  const size = fitSize({family: look.fonts.sans, weight: 600}, steps.map((s) => s.label), seg - 24, 24);
  return (
    <AbsoluteFill>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <rect x={P.x - 6} y={P.y - 70} width={P.w + 12} height={60} rx={12} fill={alpha(c.plate, 0.9)} stroke={alpha(c.text, 0.35)} />
        {steps.map((s, i) => {
          const isDone = i < done;
          const cur = i === current;
          const x0 = P.x + i * seg + 10;
          return (
            <g key={i}>
              <rect x={x0} y={P.y - 22} width={seg - 20} height={cur ? 5 : 3} fill={cur ? c.accent : isDone ? alpha(c.text, 0.85) : alpha(c.text, 0.4)} />
              <SvgText look={look} fonts={fonts} x={x0} y={P.y - 34} size={size} weight={600} color={cur ? c.accent : isDone ? c.text : alpha(c.text, 0.7)}>{isDone || cur ? s.label : `${i + 1}`}</SvgText>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

const STEPS = ['REVELATION', 'BODY', 'FRACTURE', 'CONTRAST', 'LOOK'].map((label) => ({label}));

export const kit: KitVersion = {
  name: 'progress',
  version: '1.0.0',
  description: "Where a lesson is among its pictures, on a plate above the 16:9 panel: finished segments named, the current one in the accent colour, the rest numbered, in the channel theme's look.",
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    steps: z.array(z.object({label: z.string().min(1).max(20)}).strict()).min(1).max(8),
    current: z.number().int().min(0),
    /** How many are finished (the first `done`). */
    done: z.number().int().min(0),
  }).strict().refine((p) => p.current < p.steps.length && p.done <= p.steps.length, {message: 'current and done count among the steps', path: ['current']}),
  component: Progress,
  examples: [
    {id: 'third', props: {look: DEMO_LOOK, steps: STEPS, current: 2, done: 2}, durationInFrames: 30, frame: 0},
    {id: 'eight', props: {look: DEMO_LOOK, steps: [...STEPS, ...STEPS.slice(0, 3)].map((s) => ({label: s.label === 'REVELATION' ? 'MMMMMMMMMMMMMMMMMMMM' : s.label})), current: 6, done: 6}, durationInFrames: 30, frame: 0},
    {id: 'first', props: {look: DEMO_LOOK, steps: STEPS, current: 0, done: 0}, durationInFrames: 30, frame: 0},
  ],
};
