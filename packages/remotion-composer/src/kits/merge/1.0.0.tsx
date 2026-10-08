// merge@1.0.0 — released: never edit this file; add merge/<next>.tsx instead.
// The figure tool for a fusion of two things into one (from CreativeStudio's
// poesie-museo-long specimen «merge»): the panel is dark and a live bolt
// crawls in it; the two words arrive as chips; the dark tears in two along a
// jagged line of light and its halves part on the picture, where bolts keep
// striking; the verb that joins the words shows, then the two chips meet in
// the result. It draws its own glass panel. Channel-neutral: the look is a
// prop (ADR-0040).
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {clamp, ease, ramp, rnd, win} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LiveBolt, boltPoints, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {GlassChip, LightLine, PANEL, PictureSchema, ptsPath, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Times {a: number; b: number; tear: number; verb: number; result: number; end: number}
interface Labels {a: string; b: string; verb: string; verbSub?: string; result: string}

const Merge: KitVersion['component'] = ({props}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const k = clamp(t / (durationInFrames / fps));
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const T = props.times as Times;
  const L = props.labels as Labels;
  const pcx = P.x + P.w / 2;
  const tear = ease((t - T.tear) / 0.9);
  const m = ease((t - T.result + 0.4) / 1);
  const tearPts = boltPoints(pcx, P.y, pcx - 30, P.y + P.h, 9, 23, 140);
  const half = (edge: number, dir: number) => [[edge, P.y], ...tearPts, [edge, P.y + P.h]].map(([x, y]) => `${x! + dir * tear * 640},${y}`).join(' ');
  const [cx, cy] = pic.focus ?? [0.5, 0.5];
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0} flash={strikeAt(t, [T.tear])}>
        <Cover src={pic.src} box={{x: 0, y: 0, w: P.w - 20, h: P.h - 20}} cx={cx} cy={cy} zoom={1.06 + 0.06 * k} filter={`brightness(${0.85 + 0.5 * strikeAt(t, [T.tear])})`} />
      </Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <defs><clipPath id={`${id}p`}><rect x={P.x} y={P.y} width={P.w} height={P.h} rx={look.measures.plateRadius + 2} /></clipPath></defs>
        <g clipPath={`url(#${id}p)`}>
          <polygon points={half(P.x, -1)} fill={c.backdrop} opacity={0.94} />
          <polygon points={half(P.x + P.w, 1)} fill={c.backdrop} opacity={0.94} />
          <LightLine look={look} d={ptsPath(tearPts)} op={strikeAt(t, [T.tear - 0.05]) * 1.2 + 0.5 * (1 - tear) * ramp(t, T.tear - 0.6, T.tear - 0.1)} width={4} />
          {/* the bolt is alive: it crawls in the dark before the tear, then keeps striking over the picture */}
          <LiveBolt look={look} t={t} x0={pcx + 220 * Math.sin(t * 0.7)} y0={P.y} x1={pcx - 160 + 120 * Math.sin(t * 0.5)} y1={P.y + P.h * 0.9}
            op={ramp(t, 0, 0.4) * (1 - ramp(t, T.tear - 0.1, T.tear)) * (0.6 + 0.4 * strikeAt(t, [1.2 + Math.floor(t / 1.4) * 1.4]))} grow={clamp(t / 1.2)} seed={3} />
          {[0, 1, 2, 3, 4, 5].map((j) => {
            const tj = T.tear + 1.6 + j * 2.6 + rnd(j) * 0.8;
            const xx = P.x + 160 + rnd(j + 9) * (P.w - 320);
            return <LiveBolt key={j} look={look} t={t} x0={xx} y0={P.y} x1={xx + (rnd(j + 4) - 0.5) * 300} y1={P.y + P.h * (0.35 + rnd(j + 2) * 0.2)} op={strikeAt(t, [tj])} grow={clamp((t - tj) / 0.12)} seed={j * 7} />;
          })}
        </g>
        <g transform={`translate(0 ${m * 150})`}><GlassChip look={look} fonts={fonts} x={pcx} y={P.y + 150} text={L.a} op={ramp(t, T.a, T.a + 0.3) * (1 - m)} size={44} /></g>
        <g transform={`translate(0 ${-m * 150})`}><GlassChip look={look} fonts={fonts} x={pcx} y={P.y + 450} text={L.b} op={ramp(t, T.b, T.b + 0.3) * (1 - m)} size={44} /></g>
        <GlassChip look={look} fonts={fonts} x={pcx} y={P.y + 300} text={L.verb} sub={L.verbSub} op={win(t, T.verb - 0.1, T.result + 0.2)} size={40} color={c.highlight} />
        <GlassChip look={look} fonts={fonts} x={pcx} y={P.y + 300} text={L.result} op={ramp(t, T.result, T.result + 0.4) * (1 - ramp(t, T.end - 0.4, T.end - 0.1))} size={48} color={c.glow} />
      </svg>
    </AbsoluteFill>
  );
};

const Label = z.string().min(1).max(22);

export const kit: KitVersion = {
  name: 'merge',
  version: '1.0.0',
  description: "The figure tool for two things fused into one, on the 16:9 panel: the dark tears along a line of light on the picture, bolts strike, the two words meet in the result, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** The first word, the second, the tear, the verb, the result, and when the chips leave. */
    times: z.object({a: z.number(), b: z.number(), tear: z.number(), verb: z.number(), result: z.number(), end: z.number()}).strict()
      .refine((x) => x.b >= x.a && x.verb < x.result && x.result < x.end, {message: 'the second word follows the first, and the verb comes before the result, before the end'}),
    labels: z.object({a: Label, b: Label, verb: Label, verbSub: z.string().min(1).max(30).optional(), result: Label}).strict(),
  }).strict(),
  component: Merge,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}, focus: [0.5, 0.4]}, times: {a: 0.6, b: 1.1, tear: 1.8, verb: 3, result: 4.2, end: 6}, labels: {a: 'SKY', b: 'EARTH', verb: 'SHOWED', verbSub: 'one verb for both', result: 'ONE WORLD'}};
    return [
      {id: 'words', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 180, frame: 40},
      {id: 'torn', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 180, frame: 100},
      {id: 'result', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 180, frame: 150},
    ];
  })(),
};
