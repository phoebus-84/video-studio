// stack@1.0.0 — released: never edit this file; add stack/<next>.tsx instead.
// The figure tool for a climax (from CreativeStudio's poesie-museo-long
// specimen «stack»): three words in a row as they are first read; then a
// staircase, each word a step heavier than the one before, a gauge of their
// weight filling; at the collapse the picture shatters into shards that fly
// into the hall, smoke rises and the glass is rebuilt, dimmed. It draws its
// own glass panel. Channel-neutral: the look is a prop (ADR-0040).
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type ColorRole, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {clamp, ease, ramp, rnd} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LoopClip, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {PANEL, PictureSchema, Shards, Smoke, SvgText, TEXT_ROLES, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Step {word: string; gloss: string; color?: ColorRole}
interface Times {w1: number; w2: number; w3: number; stairs: number; s1: number; s2: number; s3: number; collapse: number}

const Stack: KitVersion['component'] = ({props, context}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const T = props.times as Times;
  const steps = props.steps as Step[];
  const row = (props.row as string[] | undefined) ?? steps.map((s) => s.word);
  const clip = props.clip as string | undefined;
  const labels = props.labels as {weight: string};
  const inner: Box = {x: 0, y: 0, w: P.w - 20, h: P.h - 20};
  const [cx, cy] = pic.focus ?? [0.5, 0.5];
  const DEFAULT: ColorRole[] = ['glow', 'highlight', 'signal'];
  const colOf = (j: number) => c[steps[j]!.color ?? DEFAULT[j]!];
  const firstRead = [T.w1, T.w2, T.w3];
  const second = [T.s1, T.s2, T.s3];
  const toStairs = ease((t - T.stairs + 0.2) / 0.7);
  const fall = (j: number) => clamp((t - T.collapse - 0.05 - j * 0.12) / 1.1);
  const shatter = clamp((t - T.collapse) / 1.6);
  const rebuilt = ramp(t, T.collapse + 1.7, T.collapse + 2.2);
  const weight = t < T.s1 ? 0 : t < T.s2 ? 1 / 3 : t < T.s3 ? 2 / 3 : 1;
  const wk = ease((t - second[Math.max(0, Math.round(weight * 3) - 1)]!) / 0.5);
  const level = weight - (1 / 3) * (1 - wk) * (weight > 0 ? 1 : 0);
  const grade = `brightness(${1 - 0.3 * ramp(t, T.s2, T.s2 + 0.4) + strikeAt(t, [T.s2]) * 0.8}) saturate(${1 + 0.3 * ramp(t, T.s2, T.s2 + 0.4)}) contrast(1.1)`;
  const jolt = (rnd(Math.floor(t * 25)) - 0.5) * 14 * strikeAt(t, [T.s2]);
  const fallen = t >= T.collapse;
  const rowSize = fitSize({family: look.fonts.display, weight: 400}, row, (P.w - 80 - 2 * 56) / 3, 68, (s) => s * 0.04);
  const bw = Math.max(60, Math.min(280, (P.w - 200) / 3 - 20));
  const weightSize = fitSize({family: look.fonts.sans, weight: 600}, [labels.weight], 160, 26);
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0} flash={strikeAt(t, [T.s2]) + strikeAt(t, [T.collapse])}>
        {!fallen ? (
          <>
            <div style={{position: 'absolute', inset: 0, transform: `translateX(${jolt}px)`}}><Cover src={pic.src} box={inner} cx={cx} cy={cy} zoom={1.08} filter={grade} /></div>
            {clip ? <div style={{position: 'absolute', inset: 0, mixBlendMode: 'screen', opacity: 0.25 * ramp(t, T.w1, T.w1 + 0.6) + 0.4 * ramp(t, T.s1, T.s1 + 0.5)}}><LoopClip src={clip} box={inner} live={1} frames={context.assetFrames[clip]} filter="contrast(1.2)" /></div> : null}
          </>
        ) : (
          <div style={{position: 'absolute', inset: 0, background: c.backdrop}}>
            {clip ? <div style={{position: 'absolute', inset: 0, opacity: 0.8 * (1 - rebuilt * 0.5)}}><LoopClip src={clip} box={inner} live={1} frames={context.assetFrames[clip]} filter="brightness(1.3) contrast(1.1)" /></div> : null}
          </div>
        )}
        <div style={{position: 'absolute', inset: 0, background: `linear-gradient(0deg, ${alpha(c.backdrop, 0.8)}, ${alpha(c.backdrop, 0.1)} 70%)`, opacity: toStairs * (1 - ramp(t, T.collapse, T.collapse + 0.3))}} />
      </Glass>
      {fallen && shatter < 1 ? <div style={{position: 'absolute', inset: 0}}><Shards look={look} src={pic.src} box={{x: P.x + 10, y: P.y + 10, w: inner.w, h: inner.h}} k={ease(shatter)} cx={cx} cy={cy} zoom={1.08} filter={grade} /></div> : null}
      {rebuilt > 0 ? <Glass look={look} box={P} t={t} tilt={0} on={rebuilt}><Cover src={pic.src} box={inner} cx={cx} cy={0.2} zoom={1.1} filter="brightness(.55) saturate(.8)" /></Glass> : null}
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <defs><marker id={`${id}a`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill={c.highlight} /></marker></defs>
        <rect x={P.x + 40} y={P.y + P.h - 190} width={P.w - 80} height={120} rx={16} fill={alpha(c.plate, 0.92)} opacity={ramp(t, T.w1 - 0.1, T.w1 + 0.2) * (1 - toStairs)} />
        {toStairs > 0 ? steps.map((s, j) => {
          const bx = P.x + 60 + j * (bw + 20);
          const top = P.y + P.h - 150 - j * 120;
          const h = P.y + P.h - 10 - top;
          const rise = ease((t - second[j]! + 0.15) / 0.45);
          const f = fall(j);
          const nominal = 50 + j * 12;
          const size = fitSize({family: look.fonts.display, weight: 400}, [s.word], bw + 40, nominal, (x) => x * 0.04);
          const glossSize = fitSize({family: look.fonts.sans, weight: 600}, [s.gloss], bw - 20, 28);
          return (
            <g key={j} opacity={toStairs * (1 - ramp(t, T.collapse + 1.2, T.collapse + 1.6))} transform={`translate(${f * (j - 1) * 220} ${f * f * 900}) rotate(${f * (j - 1.2) * 40} ${bx + bw / 2} ${top})`}>
              <rect x={bx} y={top + h * (1 - rise)} width={bw} height={h * rise} rx={8} fill={alpha(c.text, 0.16)} stroke={colOf(j)} strokeWidth="2.5" />
              <g opacity={rise}>
                <SvgText look={look} fonts={fonts} x={bx + bw / 2} y={top - 22} size={size} anchor="middle" role="display" color={colOf(j)} ls={size * 0.04}>{s.word}</SvgText>
                <SvgText look={look} fonts={fonts} x={bx + bw / 2} y={top + 48} size={glossSize} anchor="middle" weight={600}>{s.gloss}</SvgText>
              </g>
            </g>
          );
        }) : null}
        {toStairs > 0 && t < T.collapse + 0.2 ? (
          <path d={`M${P.x + 80} ${P.y + P.h - 220} L${P.x + P.w * 0.62} ${P.y + 130}`} stroke={c.highlight} strokeWidth="5" strokeDasharray="8 10" fill="none" opacity={ramp(t, T.s1, T.s1 + 0.4)} strokeDashoffset={-t * 30} markerEnd={`url(#${id}a)`} />
        ) : null}
        {toStairs > 0 ? (
          <g opacity={toStairs * (1 - ramp(t, T.collapse, T.collapse + 0.3))}>
            <rect x={P.x + P.w - 70} y={P.y + 120} width={34} height={400} rx={17} fill={alpha(c.plate, 0.92)} stroke={alpha(c.text, 0.7)} />
            <rect x={P.x + P.w - 66} y={P.y + 516 - 392 * level} width={26} height={392 * level} rx={13} fill={weight > 0.9 ? colOf(2) : weight > 0.5 ? colOf(1) : colOf(0)} />
            <SvgText look={look} fonts={fonts} x={P.x + P.w - 30} y={P.y + 100} size={weightSize} anchor="end" weight={600}>{labels.weight}</SvgText>
          </g>
        ) : null}
        <g opacity={ramp(t, T.collapse + 0.2, T.collapse + 0.7)}><Smoke look={look} t={t} box={{x: P.x - 140, y: P.y + P.h + 14, w: P.w + 340, h: 200}} opacity={0.5 * (1 - ramp(t, T.collapse + 3, T.collapse + 4))} /></g>
        <rect x={P.x} y={P.y} width={P.w} height={P.h} fill="#fff" opacity={strikeAt(t, [T.collapse - 0.02]) * 0.7} />
      </svg>
      <div style={{position: 'absolute', left: P.x + 40, top: P.y + P.h - 190, width: P.w - 80, height: 120, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 56, opacity: 1 - toStairs}}>
        {row.map((w, j) => <div key={j} style={{fontFamily: fonts.display, fontSize: rowSize, letterSpacing: rowSize * 0.04, color: c.text, textShadow: look.measures.textShadow, whiteSpace: 'nowrap', opacity: ramp(t, firstRead[j]! - 0.05, firstRead[j]! + 0.2)}}>{w}</div>)}
      </div>
    </AbsoluteFill>
  );
};

const Word = z.string().min(1).max(20);

export const kit: KitVersion = {
  name: 'stack',
  version: '1.0.0',
  description: "The figure tool for a climax, on the 16:9 panel: three words in a row, then a staircase of growing weight with its gauge, then the picture shatters, smoke rises and the glass is rebuilt dimmed, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** The three words of the climax, lightest first; colours default to glow, highlight, signal. */
    steps: z.array(z.object({word: Word, gloss: z.string().min(1).max(24), color: z.enum(TEXT_ROLES).optional()}).strict()).length(3),
    /** The words of the row, as first read (default the steps' words). */
    row: z.array(Word).length(3).optional(),
    /** A clip of clouds blended over the picture, then left behind it after the collapse. */
    clip: AssetUrl.optional(),
    labels: z.object({weight: z.string().min(1).max(10)}).strict(),
    /** The row's words, the staircase, its steps, the collapse. */
    times: z.object({w1: z.number(), w2: z.number(), w3: z.number(), stairs: z.number(), s1: z.number(), s2: z.number(), s3: z.number(), collapse: z.number()}).strict()
      .refine((x) => x.w1 <= x.w2 && x.w2 <= x.w3 && x.w3 < x.stairs && x.stairs <= x.s1 && x.s1 < x.s2 && x.s2 < x.s3 && x.s3 < x.collapse, {message: 'the row, the staircase, its steps and the collapse come in order'}),
  }).strict(),
  component: Stack,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}}, steps: [{word: 'CLUTTERED', gloss: 'full'}, {word: 'TRAGIC', gloss: 'heavy'}, {word: 'WORN', gloss: 'broken'}], labels: {weight: 'WEIGHT'},
      times: {w1: 0.3, w2: 0.7, w3: 1.1, stairs: 2, s1: 2.3, s2: 3, s3: 3.7, collapse: 5}};
    return [
      {id: 'row', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 45},
      {id: 'stairs', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 130},
      {id: 'shattering', props: {...base, clip: {$asset: 'clip'}}, samples: {a: 'picture-a.png', clip: 'clip.mp4'}, durationInFrames: 240, frame: 168},
      {id: 'long-words', props: {...base, steps: [{word: 'MMMMMMMMMMMMMMMMMMMM', gloss: 'MMMMMMMMMMMMMMMMMMMMMMMM'}, {word: 'TRAGIC', gloss: 'a gloss of twenty-four c'}, {word: 'WORN', gloss: 'broken'}], labels: {weight: 'MMMMMMMMMM'}}, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 130},
      {id: 'rebuilt', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 230},
    ];
  })(),
};
