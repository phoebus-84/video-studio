// timeline@1.0.0 — released: never edit this file; add timeline/<next>.tsx instead.
// A lesson's timeline, in one of two ways (from CreativeStudio's
// poesie-museo-long SciTimeline and its story scenes' timeline effect):
// - axis: a thread of light with a tick every five years, stops that light up
//   as they are named, labels above and below on as many lines as they need
//   not to overlap, a cursor running to the last lit stop;
// - stops: dots in a row with a label and a sub-label each, the line drawing
//   out towards them.
// Channel-neutral: the look is a prop (ADR-0040).
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize, textWidth} from '../lib/font-metrics/1.0.0.js';
import {ease, ramp} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {SvgText, labelLines} from '../lib/lesson-tools/1.0.0.js';
import type {Box} from '../lib/lesson-stage/1.0.0.js';

interface Axis {from: number; to: number; marks: {year: number; label?: string; at: number}[]}
interface Stops {items: {label: string; sub?: string; at: number}[]; lineFrom?: number; y?: number; x0?: number; step?: number}

const Timeline: KitVersion['component'] = ({props}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const box = props.box as Box;
  const axis = props.axis as Axis | undefined;
  const stops = props.stops as Stops | undefined;
  let body: React.ReactNode = null;
  if (axis) {
    const y = box.y + box.h / 2;
    const x0 = box.x + 40;
    const x1 = box.x + box.w - 40;
    const X = (yr: number) => x0 + ((x1 - x0) * (yr - axis.from)) / (axis.to - axis.from);
    const lit = axis.marks.filter((m) => t >= m.at);
    const last = lit.at(-1);
    const prev = lit.at(-2);
    const cur = last ? (prev ? X(prev.year) + (X(last.year) - X(prev.year)) * ease((t - last.at) / 0.8) : X(last.year)) : x0;
    // each label goes on the first line where it does not touch the one before it there: above, below, then further out
    const lines = labelLines(axis.marks.map((m) => X(m.year)), axis.marks.map((m) => textWidth({family: look.fonts.sans, weight: 600}, m.label ?? String(m.year), 26, 1)), 10);
    const level = lines.map((j) => (j % 2 ? 42 + ((j - 1) / 2) * 32 : -20 - (j / 2) * 32));
    body = (
      <g>
        <defs><linearGradient id={`${id}f`} x1="0" x2="1"><stop offset="0" stopColor={c.accent} stopOpacity="0" /><stop offset=".08" stopColor={c.accent} stopOpacity=".9" /><stop offset=".92" stopColor={c.accent} stopOpacity=".9" /><stop offset="1" stopColor={c.accent} stopOpacity="0" /></linearGradient></defs>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={look.measures.plateRadius - 2} fill={alpha(c.plate, 0.86)} />
        <line x1={x0 - 30} y1={y} x2={x1 + 30} y2={y} stroke={`url(#${id}f)`} strokeWidth="1.5" opacity=".5" />
        <line x1={x0} y1={y} x2={cur} y2={y} stroke={c.accent} strokeWidth="3" />
        {Array.from({length: Math.floor((axis.to - axis.from) / 5) + 1}, (_, i) => <line key={i} x1={X(axis.from + i * 5)} y1={y - 5} x2={X(axis.from + i * 5)} y2={y + 5} stroke={alpha(c.text, 0.35)} strokeWidth="1" />)}
        {axis.marks.map((m, i) => {
          const on = ramp(t, m.at, m.at + 0.35);
          const xx = X(m.year);
          const isLast = !!last && last === m;
          const ring = (t * 1.1) % 1;
          return (
            <g key={i} opacity={0.45 + 0.55 * on}>
              <circle cx={xx} cy={y} r={on > 0.5 ? 7 : 4.5} fill={on > 0.5 ? c.highlight : alpha(c.text, 0.7)} />
              {isLast ? <circle cx={xx} cy={y} r={10 + 16 * ring} fill="none" stroke={c.highlight} strokeWidth="2" opacity={1 - ring} /> : null}
              <SvgText look={look} fonts={fonts} x={xx} y={y + level[i]!} size={26} anchor="middle" weight={600} ls={1} color={on > 0.5 ? c.highlight : c.text}>{m.label ?? String(m.year)}</SvgText>
            </g>
          );
        })}
      </g>
    );
  } else if (stops) {
    const y = box.y + (stops.y ?? 130);
    const x0 = box.x + (stops.x0 ?? 110);
    const step = stops.step ?? 205;
    const lineFrom = stops.lineFrom ?? stops.items[0]!.at;
    // labels and sub-labels fitted to the room between two stops
    const labelSize = fitSize({family: look.fonts.sans, weight: 600}, stops.items.map((s) => s.label), step - 16, 34, () => 2);
    const subSize = fitSize({family: look.fonts.sans, weight: 400}, stops.items.map((s) => s.sub ?? ''), step - 16, 30);
    const lineX = box.x + 70;
    const lineEnd = x0 + step * (stops.items.length - 1) + 15;
    body = (
      <g>
        <line x1={lineX} y1={y} x2={lineX + (lineEnd - lineX) * ramp(t, lineFrom, lineFrom + 2)} y2={y} stroke={alpha(c.text, 0.6)} strokeWidth="1.2" />
        {stops.items.map((s, i) => (
          <g key={i} opacity={ramp(t, s.at, s.at + 0.4)}>
            <circle cx={x0 + i * step} cy={y} r={9} fill={c.glow} />
            <SvgText look={look} fonts={fonts} x={x0 + i * step} y={y - 34} size={labelSize} anchor="middle" weight={600} ls={2}>{s.label}</SvgText>
            {s.sub ? <SvgText look={look} fonts={fonts} x={x0 + i * step} y={y + 50} size={subSize} anchor="middle" color={c.textDim}>{s.sub}</SvgText> : null}
          </g>
        ))}
      </g>
    );
  }
  return <AbsoluteFill><svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>{body}</svg></AbsoluteFill>;
};

export const kit: KitVersion = {
  name: 'timeline',
  version: '1.0.0',
  description: "A lesson's timeline in a 16:9 frame: an axis of years whose stops light up as they are named, or a row of dated stops the line draws out to, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** Where it is drawn (the axis's plate, or the box the stops are placed in). */
    box: BoxSchema,
    axis: z.object({
      from: z.number().int(),
      to: z.number().int(),
      marks: z.array(z.object({year: z.number(), label: z.string().min(1).max(12).optional(), at: z.number()}).strict()).min(1).max(12),
    }).strict().refine((a) => a.to > a.from && a.marks.every((m, i) => m.year >= a.from && m.year <= a.to && (i === 0 || m.year >= a.marks[i - 1]!.year)), {message: 'an axis runs forward and holds its marks, in order of year'}).optional(),
    stops: z.object({
      items: z.array(z.object({label: z.string().min(1).max(12), sub: z.string().min(1).max(20).optional(), at: z.number()}).strict()).min(1).max(5),
      lineFrom: z.number().optional(),
      y: z.number().optional(),
      x0: z.number().optional(),
      step: z.number().positive().optional(),
    }).strict().optional(),
  }).strict().refine((p) => (p.axis ? 1 : 0) + (p.stops ? 1 : 0) === 1, {message: 'a timeline is either an axis or stops'}),
  component: Timeline,
  examples: [
    {id: 'axis', props: {look: DEMO_LOOK, box: {x: 430, y: 620, w: 1100, h: 170}, axis: {from: 1860, to: 1900, marks: [{year: 1861, at: 0}, {year: 1867, at: 0.6}, {year: 1891, at: 1.2}, {year: 1894, at: 1.8}]}}, durationInFrames: 90, frame: 75},
    {id: 'axis-close', props: {look: DEMO_LOOK, box: {x: 430, y: 620, w: 1100, h: 170}, axis: {from: 1860, to: 1900, marks: [{year: 1867, at: 0}, {year: 1868, at: 0.3}, {year: 1869, at: 0.6}, {year: 1871, at: 0.9}]}}, durationInFrames: 60, frame: 50},
    {id: 'stops', props: {look: DEMO_LOOK, box: {x: 440, y: 150, w: 1060, h: 596}, stops: {items: [{label: '1867', sub: 'the father', at: 0}, {label: '1868', sub: 'the mother', at: 0.5}, {label: '1871', sub: 'Margherita', at: 1}, {label: '1876', sub: 'Luigi', at: 1.5}]}}, durationInFrames: 90, frame: 70},
    {id: 'stops-long', props: {look: DEMO_LOOK, box: {x: 440, y: 150, w: 1060, h: 596}, stops: {items: [{label: 'MMMMMMMMMMMM', sub: 'a sub-label, twenty!', at: 0}, {label: '1868', sub: 'MMMMMMMMMMMMMMMMMMMM', at: 0.2}, {label: '1871', sub: 'Margherita', at: 0.4}, {label: '1876', sub: 'Luigi', at: 0.6}, {label: '1880', sub: 'Ida', at: 0.8}]}}, durationInFrames: 90, frame: 80},
    {id: 'axis-crowded', props: {look: DEMO_LOOK, box: {x: 430, y: 560, w: 1100, h: 300}, axis: {from: 1860, to: 1900, marks: [1866, 1867, 1867, 1868, 1869, 1870].map((year, i) => ({year, at: i * 0.2}))}}, durationInFrames: 60, frame: 50},
  ],
};
