// simile@1.0.0 — released: never edit this file; add simile/<next>.tsx instead.
// The figure tool for a simile (from CreativeStudio's poesie-museo-long
// specimen «simile»): the frame closes in on an eye in the picture and its
// iris comes alive; a plate gives a word's etymology; the bridge — a drawn
// eye, "like", and the compared thing — darkens the picture; the eyelids
// open and close as two words light up; at the end the whole frame goes dark.
// It draws its own glass panel. Channel-neutral: the look is a prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ease, ramp, win} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, type Box} from '../lib/lesson-stage/1.0.0.js';
import {Eyelids, IrisLive, LightTitle, PANEL, PictureSchema, SvgText, coverPoint, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Times {subject: number; etym: number; like: number; open: number; close: number; dark: number}
interface Labels {etymWord?: string; etymOrigin?: string; etymMeaning?: string; like: string; open: string; close: string}

const Simile: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const T = props.times as Times;
  const L = props.labels as Labels;
  const eye = props.eye as {x: number; y: number; r?: number};
  const bridgeImage = props.bridgeImage as string | undefined;
  const aspect = pic.aspect ?? 4 / 3;
  const inner: Box = {x: 0, y: 0, w: P.w - 20, h: P.h - 20};
  const zoom = 1.08 + 0.7 * ease((t - T.subject) / 1.6) * (1 - ease((t - T.like) / 0.8)) + 0.7 * ease((t - T.open + 0.6) / 1);
  // the eye is the frame's focus: it stays where it is while the frame closes in
  const [ex, ey] = coverPoint(inner, aspect, 1, eye.x, eye.y, zoom, eye.x, eye.y);
  const r = coverPoint(inner, aspect, 1, eye.x, eye.y, zoom, eye.x + (eye.r ?? 0.148), eye.y)[0] - ex;
  let open = 1;
  if (t > T.close) open = 1 - ease((t - T.close) / 0.45);
  else if (t > T.open - 0.6 && t < T.open) open = 0.15 + 0.85 * ease((t - T.open + 0.6) / 0.6);
  const bridge = win(t, T.like - 0.1, T.open - 0.6);
  const pcx = P.x + P.w / 2;
  const etymSize = fitSize({family: look.fonts.sans, weight: 300}, [L.etymWord ?? ''], 600 - 72, 52, () => 2);
  const etymSub = fitSize({family: look.fonts.serif, weight: 400, style: 'italic'}, [L.etymOrigin ?? ''], 600 - 72, 30);
  const etymMeaning = fitSize({family: look.fonts.sans, weight: 400}, [L.etymMeaning ?? ''], 600 - 72, 26, () => 3);
  const wordSize = fitSize({family: look.fonts.sans, weight: 200}, [L.open, L.close], P.w - 120, 72, (s) => s * 0.04);
  const dark = ease(t - T.dark) * 0.95;
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0}>
        <Cover src={pic.src} box={inner} cx={eye.x} cy={eye.y} zoom={zoom} />
        <IrisLive t={t} src={pic.src} box={inner} cx={eye.x} cy={eye.y} zoom={zoom} ex={ex} ey={ey} r={r} op={open * (1 - bridge)} />
        <svg viewBox={`0 0 ${inner.w} ${inner.h}`} style={{position: 'absolute', inset: 0, width: inner.w, height: inner.h}}><Eyelids look={look} open={open} cx={ex} cy={ey} w={1500} /></svg>
        <div style={{position: 'absolute', inset: 0, background: alpha(c.backdrop, 0.8), opacity: bridge}} />
        {bridge > 0 && bridgeImage ? <Img src={bridgeImage} style={{position: 'absolute', left: 70, top: 150, width: 320, height: 240, objectFit: 'contain', opacity: bridge}} /> : null}
      </Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        {L.etymWord ? (
          <g opacity={win(t, T.etym, T.like - 0.1)}>
            <rect x={P.x + 50} y={P.y + 70} width={600} height={190} rx={14} fill={alpha(c.plate, 0.92)} stroke={alpha(c.text, 0.7)} />
            <SvgText look={look} fonts={fonts} x={P.x + 86} y={P.y + 140} size={etymSize} weight={300} ls={2}>{L.etymWord}</SvgText>
            {L.etymOrigin ? <SvgText look={look} fonts={fonts} x={P.x + 86} y={P.y + 190} size={etymSub} role="serif" italic color={c.glow}>{L.etymOrigin}</SvgText> : null}
            {L.etymMeaning ? <SvgText look={look} fonts={fonts} x={P.x + 86} y={P.y + 236} size={etymMeaning} ls={3} color={c.textDim}>{L.etymMeaning}</SvgText> : null}
          </g>
        ) : null}
        <g opacity={bridge}>
          <g transform={`translate(${P.x + P.w - 260} ${P.y + 280})`}>
            <path d="M-170 0 Q0 -120 170 0 Q0 120 -170 0 Z" fill={alpha(c.text, 0.9)} stroke={c.glow} strokeWidth="3" />
            <circle r={62} fill={c.accent} /><circle r={30} fill={c.ink} /><circle cx={18} cy={-20} r={10} fill="#fff" />
          </g>
          <line x1={P.x + 420} y1={P.y + 290} x2={P.x + 420 + 240 * ramp(t, T.like, T.like + 0.6)} y2={P.y + 290} stroke={c.highlight} strokeWidth="2" />
          <LightTitle look={look} fonts={fonts} t={t} at={T.like} x={pcx - 10} y={P.y + 270} size={64} text={L.like} weight={200} color={c.highlight} />
        </g>
        <LightTitle look={look} fonts={fonts} t={t} at={T.open} x={P.x + 60} y={P.y + 140} size={wordSize} text={L.open} anchor="start" weight={200} color={c.highlight} until={T.dark} />
        <LightTitle look={look} fonts={fonts} t={t} at={T.close} x={P.x + 60} y={P.y + 230} size={wordSize} text={L.close} anchor="start" weight={200} until={T.dark} />
      </svg>
      {dark > 0 ? <AbsoluteFill style={{background: '#000', opacity: dark}} /> : null}
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'simile',
  version: '1.0.0',
  description: "The figure tool for a simile, on the 16:9 panel: the frame closes in on an eye whose iris comes alive, an etymology plate, the bridge with a drawn eye and \"like\", eyelids opening and closing, then the whole frame going dark, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** The eye on the picture (0–1), and its iris's radius as a share of the picture's width. */
    eye: z.object({x: z.number().min(0).max(1), y: z.number().min(0).max(1), r: z.number().positive().max(0.5).optional()}).strict(),
    times: z.object({subject: z.number(), etym: z.number(), like: z.number(), open: z.number(), close: z.number(), dark: z.number()}).strict()
      .refine((x) => x.subject <= x.etym && x.etym < x.like && x.open - x.like >= 0.8 && x.open < x.close && x.close < x.dark, {message: 'the subject, the etymology, the bridge (at least 0.8 s), the eye opening and closing and the dark come in order'}),
    labels: z.object({etymWord: z.string().min(1).max(20).optional(), etymOrigin: z.string().min(1).max(40).optional(), etymMeaning: z.string().min(1).max(40).optional(),
      like: z.string().min(1).max(12), open: z.string().min(1).max(16), close: z.string().min(1).max(16)}).strict()
      .refine((l) => l.etymWord !== undefined || (l.etymOrigin === undefined && l.etymMeaning === undefined), {message: 'an etymology names its word', path: ['etymWord']}),
    /** The compared thing, shown in the bridge. */
    bridgeImage: AssetUrl.optional(),
  }).strict(),
  component: Simile,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}, aspect: 4 / 3}, eye: {x: 0.5, y: 0.3},
      times: {subject: 0.2, etym: 1.8, like: 3.4, open: 5.4, close: 6.2, dark: 7.2},
      labels: {etymWord: 'STARTLED', etymOrigin: 'from the old word for fear', etymMeaning: 'WIDE OPEN WITH FEAR', like: 'LIKE', open: 'OPENED', close: 'CLOSED'}};
    return [
      {id: 'iris', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 270, frame: 45},
      {id: 'etymology', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 270, frame: 75},
      {id: 'bridge', props: {...base, bridgeImage: {$asset: 'b'}}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 270, frame: 125},
      {id: 'long-etymology', props: {...base, labels: {...base.labels, etymWord: 'MMMMMMMMMMMMMMMMMMMM', etymOrigin: 'from a word whose origin takes forty ch.', etymMeaning: 'A MEANING WRITTEN OUT IN FORTY CHARACTERS'.slice(0, 40)}}, samples: {a: 'picture-a.png'}, durationInFrames: 270, frame: 75},
      {id: 'closing', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 270, frame: 200},
      {id: 'darkening', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 270, frame: 228},
    ];
  })(),
};
