// syllables@1.0.0 — released: never edit this file; add syllables/<next>.tsx instead.
// The metre lesson's count (from CreativeStudio's poesie-museo-long «metrica»):
// a verse's syllables as tiles, one by one; arcs over the vowels that meet
// between two words; the rule and what follows from it; the tiles closing up
// as the vowels merge, each merge written out; the count falling to the
// metric syllables, and the figure's name. Channel-neutral: the look is a
// prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ease, ramp} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Glass, type Box} from '../lib/lesson-stage/1.0.0.js';
import {LightTitle, PANEL, SvgText} from '../lib/lesson-tools/1.0.0.js';

interface Merge {a: number; b: number; label: string; vowels: string; text: string; at: number}
interface Times {sample: number; vowel: number; breath: number; figure: number; metric: number}
interface Labels {counted: string; metric: string; rule: string; ruleResult: string; figure?: string}

const Syllables: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const syl = props.syllables as string[];
  const merges = (props.merges as Merge[] | undefined) ?? [];
  const metric = props.metric as number;
  const T = props.times as Times;
  const L = props.labels as Labels;
  const gap = 8;
  const tileW = Math.min(66, (P.w - 140) / syl.length - gap);
  const x0 = P.x + 70;
  const mk = merges.map((m) => ease((t - m.at) / 0.8));
  const tiles = syl.map((s, i) => ({s, i, x: x0 + (i - merges.reduce((sh, m, j) => sh + (i >= m.b ? mk[j]! : 0), 0)) * (tileW + gap)}));
  const shown = T.sample + 0.8 + syl.length * 0.1 + 0.3;
  const count = t < shown ? null : t < T.metric - 0.2 ? Math.round(syl.length - mk.reduce((s, x) => s + x, 0)) : metric;
  const tileSize = fitSize({family: look.fonts.sans, weight: 400}, [...syl, ...merges.map((m) => m.label)], tileW - 10, 30);
  const ruleSize = fitSize({family: look.fonts.sans, weight: 300}, [L.rule], P.w - 140 - 260, 26);
  const resultSize = fitSize({family: look.fonts.sans, weight: 400}, [L.ruleResult], P.w - 140 - 260, 30);
  const mergeSize = fitSize({family: look.fonts.serif, weight: 400, style: 'italic'}, merges.map((m) => m.text), P.w - 140 - 260, 40);
  const figSize = fitSize({family: look.fonts.sans, weight: 200}, [L.figure ?? ''], P.w - 140, 56, (s) => s * 0.04);
  const capSize = fitSize({family: look.fonts.sans, weight: 400}, [L.counted, L.metric], 420, 26, () => 4);
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0}><div style={{position: 'absolute', inset: 0, background: `radial-gradient(900px 500px at 40% 40%, ${alpha(c.accent, 0.3)}, ${alpha(c.backdrop, 0.85)})`}} /></Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        {tiles.map(({s, i, x}) => {
          const j = merges.findIndex((m) => i === m.a || i === m.b);
          const m = j < 0 ? 0 : mk[j]!;
          const isB = j >= 0 && i === merges[j]!.b;
          const hot = j >= 0 && t > T.vowel;
          const label = j >= 0 && i === merges[j]!.a && m > 0.5 ? merges[j]!.label : s;
          return (
            <g key={i} opacity={ramp(t, T.sample + 0.8 + i * 0.1, T.sample + 1 + i * 0.1) * (isB ? 1 - m : 1)} transform={`translate(${x} ${P.y + 150})`}>
              <rect width={tileW} height={tileW} rx={10} fill={hot ? alpha(c.lightning, 0.35) : alpha(c.text, 0.12)} stroke={hot ? c.lightning : alpha(c.text, 0.7)} strokeWidth="1.3" />
              <SvgText look={look} fonts={fonts} x={tileW / 2} y={tileW * 0.64} size={tileSize} anchor="middle">{label}</SvgText>
            </g>
          );
        })}
        {merges.map((mg, j) => {
          const xa = tiles[mg.a]!.x + tileW * 0.8;
          const xc = tiles[mg.b]!.x + tileW * 0.2;
          return (
            <g key={j} opacity={ramp(t, T.vowel + j * 0.3, T.vowel + 0.4 + j * 0.3) * (1 - mk[j]!)}>
              <path d={`M${xa} ${P.y + 140} Q${(xa + xc) / 2} ${P.y + 90} ${xc} ${P.y + 140}`} stroke={c.lightning} strokeWidth="3" fill="none" />
              <SvgText look={look} fonts={fonts} x={(xa + xc) / 2} y={P.y + 100} size={22} anchor="middle" color={c.lightning}>{mg.vowels}</SvgText>
            </g>
          );
        })}
        <g opacity={ramp(t, T.vowel, T.vowel + 0.4)}>
          <SvgText look={look} fonts={fonts} x={x0} y={P.y + 360} size={ruleSize} weight={300} color={c.textDim}>{L.rule}</SvgText>
          <SvgText look={look} fonts={fonts} x={x0} y={P.y + 405} size={resultSize} color={c.glow} op={ramp(t, T.breath, T.breath + 0.3)}>{L.ruleResult}</SvgText>
        </g>
        {merges.map((mg, j) => <LightTitle key={j} look={look} fonts={fonts} t={t} at={mg.at} x={x0} y={P.y + 480 + 55 * j} size={mergeSize} text={mg.text} anchor="start" role="serif" italic weight={400} color={c.highlight} />)}
        {count !== null ? (
          <g transform={`translate(${P.x + P.w - 70} ${P.y + 520})`}>
            <SvgText look={look} fonts={fonts} x={0} y={0} size={150} anchor="end" weight={200} color={count === metric ? c.highlight : c.text}>{count}</SvgText>
            <SvgText look={look} fonts={fonts} x={0} y={36} size={capSize} anchor="end" ls={4} color={c.textDim}>{count === metric ? L.metric : L.counted}</SvgText>
          </g>
        ) : null}
        {L.figure ? <LightTitle look={look} fonts={fonts} t={t} at={T.figure} x={P.x + P.w - 70} y={P.y + 330} size={figSize} text={L.figure} anchor="end" weight={200} color={c.lightning} /> : null}
      </svg>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'syllables',
  version: '1.0.0',
  description: "The metre lesson's count on the 16:9 panel: a verse's syllables as tiles, arcs over the vowels that meet, the rule, the tiles closing up as they merge, the count falling to the metric syllables, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    /** The verse's syllables, counted one by one. */
    syllables: z.array(z.string().min(1).max(6)).min(2).max(20),
    /** Where two syllables merge into one: `b` is the syllable after `a`. */
    merges: z.array(z.object({a: z.number().int().min(0), b: z.number().int().min(1), label: z.string().min(1).max(8), vowels: z.string().min(1).max(8), text: z.string().min(1).max(40), at: z.number()}).strict()).max(2).optional(),
    /** The count once the vowels have merged. */
    metric: z.number().int().positive(),
    times: z.object({sample: z.number(), vowel: z.number(), breath: z.number(), figure: z.number(), metric: z.number()}).strict(),
    labels: z.object({counted: z.string().min(1).max(40), metric: z.string().min(1).max(40), rule: z.string().min(1).max(60), ruleResult: z.string().min(1).max(60), figure: z.string().min(1).max(20).optional()}).strict(),
  }).strict().superRefine((p, ctx) => {
    (p.merges ?? []).forEach((m, j) => {
      if (m.b !== m.a + 1 || m.b >= p.syllables.length) ctx.addIssue({code: 'custom', message: 'a merge joins a syllable with the next one', path: ['merges', j, 'b']});
    });
  }),
  component: Syllables,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, syllables: ['la', 'ter', 'ra', 'an', 'si', 'mo', 'sa', 'li', 'vi', 'da', 'in', 'sus', 'sul', 'to'],
      merges: [{a: 2, b: 3, label: 'ran', vowels: 'a + a', text: 'terra ansimosa → terransimosa', at: 3.4}, {a: 9, b: 10, label: 'din', vowels: 'a + i', text: 'livida in → lividin', at: 4.4}],
      metric: 12, times: {sample: 0, vowel: 2, breath: 2.6, figure: 5.4, metric: 6},
      labels: {counted: 'SYLLABLES COUNTED ONE BY ONE', metric: 'METRIC SYLLABLES', rule: 'ends with a vowel  +  starts with a vowel', ruleResult: '→ one breath, one syllable', figure: 'SYNALOEPHA'}};
    return [
      {id: 'counted', props: base, samples: {}, durationInFrames: 240, frame: 70},
      {id: 'merging', props: base, samples: {}, durationInFrames: 240, frame: 125},
      {id: 'metric', props: base, samples: {}, durationInFrames: 240, frame: 200},
    ];
  })(),
};
