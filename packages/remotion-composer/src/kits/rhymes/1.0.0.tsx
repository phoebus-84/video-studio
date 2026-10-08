// rhymes@1.0.0 — released: never edit this file; add rhymes/<next>.tsx instead.
// The metre lesson's rhymes (from CreativeStudio's poesie-museo-long
// «metrica»): the last word of each verse with its letter in the rhyme
// scheme; a pair lights up and an arc joins them; their name lights; an eye
// opens and closes. Channel-neutral: the look is a prop (ADR-0040).
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

interface Times {rhymes: number; a: number; b: number; close: number}

const Rhymes: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const ends = props.ends as string[];
  const scheme = props.scheme as string;
  const [pa, pb] = props.pair as [number, number];
  const T = props.times as Times;
  const DY = Math.min(58, 400 / ends.length);
  const Y = (i: number) => P.y + 160 + i * DY;
  const endSize = fitSize({family: look.fonts.serif, weight: 400, style: 'italic'}, ends, 300, Math.min(38, DY * 0.7));
  const titleSize = fitSize({family: look.fonts.sans, weight: 300}, [props.title as string], P.w - 140, 44, (s) => s * 0.04);
  const labelSize = fitSize({family: look.fonts.sans, weight: 200}, [props.label as string], P.w - 640 - 40, 70, (s) => s * 0.04);
  const shut = 1 - ease((t - T.close - 0.6) / 0.5);
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0}><div style={{position: 'absolute', inset: 0, background: `radial-gradient(900px 500px at 40% 40%, ${alpha(c.accent, 0.3)}, ${alpha(c.backdrop, 0.85)})`}} /></Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <LightTitle look={look} fonts={fonts} t={t} at={T.rhymes} x={P.x + 70} y={P.y + 100} size={titleSize} text={props.title as string} anchor="start" weight={300} />
        {ends.map((e, i) => {
          const lit = (i === pa && t > T.a) || (i === pb && t > T.b);
          return (
            <g key={i} opacity={ramp(t, T.rhymes + i * 0.12, T.rhymes + 0.25 + i * 0.12)}>
              <SvgText look={look} fonts={fonts} x={P.x + 380} y={Y(i)} size={endSize} role="serif" italic anchor="end" color={lit ? c.highlight : c.text}>{e}</SvgText>
              <circle cx={P.x + 420} cy={Y(i) - 12} r={16} fill={lit ? c.highlight : alpha(c.text, 0.2)} stroke={alpha(c.text, 0.7)} />
              <text x={P.x + 420} y={Y(i) - 5} fontSize={20} fontFamily={fonts.sans} fontWeight={600} textAnchor="middle" fill={lit ? c.ink : c.text}>{scheme[i]}</text>
            </g>
          );
        })}
        <path d={`M${P.x + 445} ${Y(pa) - 12} Q${P.x + 760} ${(Y(pa) + Y(pb)) / 2 - 12} ${P.x + 445} ${Y(pb) - 12}`} stroke={c.highlight} strokeWidth="4" fill="none" strokeDasharray="900" strokeDashoffset={900 * (1 - ease((t - T.b) / 0.9))} />
        <LightTitle look={look} fonts={fonts} t={t} at={T.b + 0.5} x={P.x + 640} y={P.y + 340} size={labelSize} text={props.label as string} anchor="start" weight={200} color={c.highlight} />
        {t > T.close ? (
          <g transform={`translate(${P.x + 820} ${P.y + 470})`} opacity={ramp(t, T.close, T.close + 0.3)}>
            <path d={`M-110 0 Q0 ${-80 * shut} 110 0 Q0 ${80 * shut} -110 0 Z`} fill={alpha(c.text, 0.9)} stroke={c.highlight} strokeWidth="3" />
            <circle r={36 * shut} fill={c.ink} />
          </g>
        ) : null}
      </svg>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'rhymes',
  version: '1.0.0',
  description: "The metre lesson's rhymes on the 16:9 panel: the last word of each verse with its scheme letter, a rhyming pair lit and joined by an arc, its name, an eye closing, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    /** The last word of each verse. */
    ends: z.array(z.string().min(1).max(20)).min(2).max(10),
    /** One letter per verse (ABCBCCA). */
    scheme: z.string().regex(/^[A-Z]+$/),
    /** The two verses whose rhyme is shown. */
    pair: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    title: z.string().min(1).max(30),
    label: z.string().min(1).max(24),
    times: z.object({rhymes: z.number(), a: z.number(), b: z.number(), close: z.number()}).strict()
      .refine((x) => x.rhymes <= x.a && x.a <= x.b && x.b <= x.close, {message: 'the rhymes, the pair and the eye come in order'}),
  }).strict().superRefine((p, ctx) => {
    if (p.scheme.length !== p.ends.length) ctx.addIssue({code: 'custom', message: 'one scheme letter per verse', path: ['scheme']});
    if (!(p.pair[0] < p.pair[1] && p.pair[1] < p.ends.length)) ctx.addIssue({code: 'custom', message: 'the pair is two of the verses, in order', path: ['pair']});
  }),
  component: Rhymes,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, ends: ['were', 'turmoil', 'worn', 'tumult', 'flash', 'startled', 'night'], scheme: 'ABCBCCA', pair: [0, 6], title: 'THE RHYMES', label: 'FIRST AND LAST',
      times: {rhymes: 0, a: 1.2, b: 2, close: 3.6}};
    return [
      {id: 'pair', props: base, samples: {}, durationInFrames: 180, frame: 100},
      {id: 'closing', props: base, samples: {}, durationInFrames: 180, frame: 140},
    ];
  })(),
};
