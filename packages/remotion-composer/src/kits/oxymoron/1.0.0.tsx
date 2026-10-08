// oxymoron@1.0.0 — released: never edit this file; add oxymoron/<next>.tsx instead.
// The figure tool for an oxymoron (from CreativeStudio's poesie-museo-long
// specimen «oxymoron»): a glow on a point of the picture with its chip; the
// panel splits into two halves, a calm word over a calm wave and its opposite
// over an agitated one; the picture lights up and goes dark as two words light
// up; the conjunction that is missing appears, struck out. It draws its own
// glass panel. Channel-neutral: the look is a prop (ADR-0040).
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ramp, win} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {GlassChip, LightTitle, PANEL, PictureSchema, SvgText, Tag, coverPoint, wavePath, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Times {glow: number; a: number; b: number; on: number; off: number; noConj: number}
interface Labels {glow: string; glowSub?: string; a: string; aSub?: string; b: string; bSub?: string; on: string; off: string; conj: string; noConj: string}
const ZOOM = 1.08;

const Oxymoron: KitVersion['component'] = ({props}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const end = durationInFrames / fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const T = props.times as Times;
  const L = props.labels as Labels;
  const [hx, hy] = props.house as [number, number];
  const [cx, cy] = pic.focus ?? [0.5, 0.5];
  const IN: Box = {x: P.x + 10, y: P.y + 10, w: P.w - 20, h: P.h - 20};
  const [px, py] = coverPoint(IN, pic.aspect ?? 4 / 3, 1, cx, cy, ZOOM, hx, hy);
  const pcx = P.x + P.w / 2;
  const light = t < T.on ? 1 : t < T.off ? 1.55 : t < T.off + 2.3 ? 0.15 : 1;
  const split = ramp(t, T.a, T.a + 0.4) * (1 - ramp(t, T.on - 0.4, T.on));
  const half = P.w / 2 - 80;
  const wordSize = fitSize({family: look.fonts.sans, weight: 200}, [L.a, L.b], half, 72, (s) => s * 0.11);
  const subSize = fitSize({family: look.fonts.sans, weight: 400}, [L.aSub ?? '', L.bSub ?? ''], half, 26, () => 4);
  const lightSize = fitSize({family: look.fonts.sans, weight: 200}, [L.on, L.off], 380, 84, (s) => s * 0.04);
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0} flash={strikeAt(t, [T.on])}>
        <Cover src={pic.src} box={{x: 0, y: 0, w: IN.w, h: IN.h}} cx={cx} cy={cy} zoom={ZOOM} filter={`brightness(${light})`} />
      </Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <defs>
          <radialGradient id={`${id}g`}><stop offset="0" stopColor={c.highlight} stopOpacity=".75" /><stop offset=".5" stopColor={c.highlight} stopOpacity=".25" /><stop offset="1" stopColor={c.highlight} stopOpacity="0" /></radialGradient>
          <clipPath id={`${id}p`}><rect x={P.x} y={P.y} width={P.w} height={P.h} rx={look.measures.plateRadius + 2} /></clipPath>
        </defs>
        <circle cx={px} cy={py} r={110 + 14 * Math.sin(t * 4)} fill={`url(#${id}g)`} opacity={ramp(t, T.glow, T.glow + 0.4) * (1 - ramp(t, T.a, T.a + 0.4))} />
        <GlassChip look={look} fonts={fonts} x={px} y={Math.max(P.y + 70, py - 140)} text={L.glow} room={P.w - 80} sub={L.glowSub} op={ramp(t, T.glow + 0.3, T.glow + 0.6) * (1 - ramp(t, T.a - 0.2, T.a + 0.1))} size={30} />
        <g opacity={split} clipPath={`url(#${id}p)`}>
          <rect x={P.x} y={P.y} width={P.w / 2} height={P.h} fill={alpha(c.backdrop, 0.78)} />
          <rect x={pcx} y={P.y} width={P.w / 2} height={P.h} fill={alpha(c.signal, 0.25)} />
          <rect x={pcx} y={P.y} width={P.w / 2} height={P.h} fill={alpha(c.backdrop, 0.6)} />
          <SvgText look={look} fonts={fonts} x={P.x + P.w / 4} y={P.y + 170} size={wordSize} anchor="middle" weight={200} ls={wordSize * 0.11}>{L.a}</SvgText>
          {L.aSub ? <SvgText look={look} fonts={fonts} x={P.x + P.w / 4} y={P.y + 220} size={subSize} anchor="middle" ls={4} color={c.textDim}>{L.aSub}</SvgText> : null}
          <path d={wavePath(P.x + 60, P.y + 360, P.w / 2 - 120, 4, t, 0)} stroke={c.glow} strokeWidth="3" fill="none" />
          <g opacity={ramp(t, T.b, T.b + 0.3)}>
            <SvgText look={look} fonts={fonts} x={P.x + P.w * 0.75} y={P.y + 170} size={wordSize} anchor="middle" weight={200} ls={wordSize * 0.11} color={c.signal}>{L.b}</SvgText>
            {L.bSub ? <SvgText look={look} fonts={fonts} x={P.x + P.w * 0.75} y={P.y + 220} size={subSize} anchor="middle" ls={4} color={c.textDim}>{L.bSub}</SvgText> : null}
            <path d={wavePath(pcx + 60, P.y + 360, P.w / 2 - 120, 80, t * 1.6, 1)} stroke={c.signal} strokeWidth="3" fill="none" />
          </g>
        </g>
        <LightTitle look={look} fonts={fonts} t={t} at={T.on} x={pcx - 200} y={P.y + 140} size={lightSize} text={L.on} weight={200} color={c.highlight} until={end + 1} />
        <LightTitle look={look} fonts={fonts} t={t} at={T.off} x={pcx + 210} y={P.y + 140} size={lightSize} text={L.off} weight={200} until={end + 1} />
        {t > T.noConj ? (
          <g opacity={win(t, T.noConj, T.noConj + 3.4)}>
            <SvgText look={look} fonts={fonts} x={pcx} y={P.y + 330} size={120} anchor="middle" role="serif" italic>{L.conj}</SvgText>
            <path d={`M${pcx - 55} ${P.y + 340} L${pcx + 55} ${P.y + 250}`} stroke={c.signal} strokeWidth="6" strokeLinecap="round" strokeDasharray="150" strokeDashoffset={150 * (1 - ramp(t, T.noConj + 0.2, T.noConj + 0.5))} />
            <Tag look={look} fonts={fonts} x={pcx} y={P.y + 420} anchor="middle" text={L.noConj} color={c.signal} />
          </g>
        ) : null}
      </svg>
    </AbsoluteFill>
  );
};

const Word = z.string().min(1).max(16);
const Sub = z.string().min(1).max(30);

export const kit: KitVersion = {
  name: 'oxymoron',
  version: '1.0.0',
  description: "The figure tool for an oxymoron, on the 16:9 panel: a glow on a point of the picture, two halves with a calm and an agitated wave, the picture lighting up and going dark, the missing conjunction struck out, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** The point of the picture (0–1) that glows. */
    house: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    times: z.object({glow: z.number(), a: z.number(), b: z.number(), on: z.number(), off: z.number(), noConj: z.number()}).strict()
      .refine((x) => x.glow <= x.a && x.a <= x.b && x.b < x.on && x.on <= x.off && x.off <= x.noConj, {message: 'the glow, the two halves, the light on and off and the conjunction come in order'}),
    labels: z.object({glow: z.string().min(1).max(20), glowSub: Sub.optional(), a: Word, aSub: Sub.optional(), b: Word, bSub: Sub.optional(), on: Word, off: Word, conj: z.string().min(1).max(4), noConj: z.string().min(1).max(24)}).strict(),
  }).strict(),
  component: Oxymoron,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}, aspect: 4 / 3}, house: [0.63, 0.61],
      times: {glow: 0.3, a: 1.5, b: 2, on: 3.2, off: 3.8, noConj: 4.6},
      labels: {glow: 'THE HOUSE', glowSub: 'white, white', a: 'SILENT', aSub: 'no sound', b: 'TUMULT', bSub: 'all the noise', on: 'APPEARED', off: 'VANISHED', conj: 'and', noConj: 'NO CONJUNCTION'}};
    return [
      {id: 'glow', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 30},
      {id: 'halves', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 80},
      {id: 'long-labels', props: {...base, labels: {...base.labels, glow: 'WWWWWWWWWWWWWWWWWWWW', glowSub: 'a sub-line of thirty characters'.slice(0, 30), a: 'MMMMMMMMMMMMMMMM', aSub: 'a sub-line of thirty characters'.slice(0, 30), b: 'WWWWWWWWWWWWWWWW', bSub: 'a sub-line of thirty characters'.slice(0, 30)}}, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 80},
      {id: 'struck', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 160},
    ];
  })(),
};
