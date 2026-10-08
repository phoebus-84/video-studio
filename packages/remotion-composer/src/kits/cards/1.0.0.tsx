// cards@1.0.0 — released: never edit this file; add cards/<next>.tsx instead.
// The figure tool for a thing given a body (from CreativeStudio's
// poesie-museo-long specimen «cards»): wind blows across the hall, the picture
// breathes, up to three cards slide in on its right — an icon, a word and its
// meaning — and the last one jolts the picture; then the human words stack on
// the left. It draws its own glass panel. Channel-neutral: the look is a prop
// (ADR-0040).
import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {clamp, ease, ramp, rnd, win} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, type Box} from '../lib/lesson-stage/1.0.0.js';
import {PANEL, PictureSchema, SvgText, Wind, back, fitLine, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Card {word: string; gloss: string; icon: string; pulse?: boolean; at: number}

const Cards: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const cards = props.cards as Card[];
  const times = props.times as {human: number; end: number};
  const human = (props.human as string[] | undefined) ?? [];
  const first = cards[0]!.at;
  const last = cards.at(-1)!.at;
  const breath = 1 + 0.03 * Math.sin(t * 2.8) * ramp(t, first, first + 0.4);
  const jolt = (rnd(Math.floor(t * 22)) - 0.5) * 10 * win(t, last, last + 2, 0.1);
  const [cx, cy] = pic.focus ?? [0.5, 0.5];
  const out = 1 - ramp(t, times.end - 0.4, times.end);
  const wordSize = fitSize({family: look.fonts.sans, weight: 600}, cards.map((x) => x.word), 530 - 126 - 24, 44, (s) => s * 0.07);
  const glossSize = fitSize({family: look.fonts.serif, weight: 400, style: 'italic'}, cards.map((x) => x.gloss), 530 - 126 - 24, 30);
  const humanSize = fitLine({family: look.fonts.display, weight: 400}, human, 420, 54, () => 2, (s) => s * 0.64 + 24);
  return (
    <AbsoluteFill>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}><Wind look={look} t={t} opacity={0.5 * ramp(t, 0, 1)} strength={1.2} y0={80} y1={1000} /></svg>
      <Glass look={look} box={P} t={t} tilt={0}>
        <div style={{position: 'absolute', inset: 0, transform: `translateY(${jolt}px)`}}>
          <Cover src={pic.src} box={{x: 0, y: 0, w: P.w - 20, h: P.h - 20}} cx={cx} cy={cy} zoom={1.08 * breath} filter="saturate(1.15)" />
        </div>
        <div style={{position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${alpha(c.backdrop, 0)} 40%, ${alpha(c.backdrop, 0.6)})`, opacity: ramp(t, first - 0.3, first + 0.1) * out}} />
      </Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        {cards.map((card, j) => {
          const y = P.y + 60 + j * 170;
          const x = P.x + P.w - 560;
          const show = ramp(t, card.at, card.at + 0.35) * out;
          const icx = x + 66;
          const icy = y + 64;
          return (
            <g key={j} opacity={show} transform={`translate(${(1 - back((t - card.at) / 0.45)) * 90} 0)`}>
              <rect x={x} y={y} width={530} height={140} rx={14} fill={alpha(c.plate, 0.9)} stroke={alpha(c.text, 0.65)} strokeWidth="1.2" />
              {card.icon === 'bruise' ? (
                <circle cx={icx} cy={icy} r={28 + 3 * Math.sin(t * 2)} fill={alpha(c.lightning, 0.55)} stroke={c.lightning} strokeWidth="2" />
              ) : (
                <g>
                  <circle cx={icx} cy={icy} r={40} fill={alpha(c.accent, 0.25)} stroke={c.accent} strokeWidth="2.5" />
                  <g transform={card.pulse ? `translate(${icx} ${icy}) scale(${1 + 0.08 * Math.sin(t * 5)}) translate(${-icx} ${-icy})` : undefined}>
                    <foreignObject x={icx - 28} y={icy - 28} width={56} height={56}><Img src={card.icon} style={{width: 56, height: 56, objectFit: 'contain'}} /></foreignObject>
                  </g>
                </g>
              )}
              <SvgText look={look} fonts={fonts} x={x + 126} y={y + 62} size={wordSize} weight={600} ls={wordSize * 0.07}>{card.word}</SvgText>
              <SvgText look={look} fonts={fonts} x={x + 126} y={y + 108} size={glossSize} role="serif" italic color={c.glow}>{card.gloss}</SvgText>
            </g>
          );
        })}
      </svg>
      <div style={{position: 'absolute', left: P.x + 44, top: P.y + 60, width: 420, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6}}>
        {human.map((h, j) => {
          const a = times.human + 0.15 * j;
          const e = ease((t - a) / 0.55);
          return (
            <div key={j} style={{display: 'inline-block', padding: '.12em .32em .16em', ...plateStyle(look), fontFamily: fonts.display, fontSize: humanSize, letterSpacing: 2, lineHeight: 1.08, whiteSpace: 'nowrap',
              color: j ? c.highlight : c.text, textShadow: look.measures.textShadow, opacity: clamp((t - a) / 0.3) * out, transform: `translateY(${(1 - e) * 14}px)`}}>{h}</div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'cards',
  version: '1.0.0',
  description: "The figure tool for a thing given a body, on the 16:9 panel: wind blows, up to three cards slide in — icon, word, meaning — the last one jolting the picture, and the human words stack beside them, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** Each card's icon is a picture, or "bruise" (a drawn bruise). */
    cards: z.array(z.object({word: z.string().min(1).max(14), gloss: z.string().min(1).max(30), icon: z.union([AssetUrl, z.literal('bruise')]), pulse: z.boolean().optional(), at: z.number()}).strict()).min(1).max(3)
      .refine((cs) => cs.every((x, i) => i === 0 || x.at >= cs[i - 1]!.at), {message: 'the cards come one after the other'}),
    /** The human words, stacked on the left from `times.human`. */
    human: z.array(z.string().min(1).max(20)).max(4).optional(),
    /** When the human words come, and when the cards and words leave. */
    times: z.object({human: z.number(), end: z.number()}).strict(),
  }).strict().refine((p) => p.times.end > p.times.human && p.times.end > p.cards.at(-1)!.at, {message: 'the cards and the human words show before the end', path: ['times']}),
  component: Cards,
  examples: ((): KitExample[] => {
    const cards = [
      {word: 'GASPING', gloss: 'out of breath', icon: {$asset: 'icon'}, pulse: true, at: 0.4},
      {word: 'LIVID', gloss: 'bruised, dark blue', icon: 'bruise', at: 1},
      {word: 'IN TURMOIL', gloss: 'shaken from within', icon: {$asset: 'icon'}, at: 1.6},
    ];
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}}, cards, human: ['A BODY', 'THAT SUFFERS'], times: {human: 2.4, end: 5}};
    return [
      {id: 'three-cards', props: base, samples: {a: 'picture-a.png', icon: 'figure.png'}, durationInFrames: 180, frame: 100},
      {id: 'arriving', props: base, samples: {a: 'picture-a.png', icon: 'figure.png'}, durationInFrames: 180, frame: 36},
      {id: 'long', props: {...base, cards: [{word: 'MMMMMMMMMMMMMM', gloss: 'a gloss of thirty characters!!', icon: 'bruise', at: 0}], human: ['MMMMMMMMMMMMMMMMMMMM']}, samples: {a: 'picture-a.png'}, durationInFrames: 120, frame: 90},
    ];
  })(),
};
