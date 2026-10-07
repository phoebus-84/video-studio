// interprete@1.0.0 — released: never edit this file; add interprete/<next>.tsx instead.
// The actor of "Dentro i versi · short" (CreativeStudio's sala8): the SVG
// interprete in the hall's camera, above the verse plate (hands may pass in
// front of it, UP-56), with its contact shadow and its reflection on the
// floor, lit by the lightning, hidden by the blackout, teleporting in and
// out. Pose, expression, gaze, blinks, mouth (from the voice's energy),
// liveliness and bow are worked out here from the keyframes in its props.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {clamp, ease, envelope, mix, pulse, ramp, win, type Envelope} from '../lib/stage-math/1.0.0.js';
import {CameraSchema, EnvelopeSchema, FlashSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Teleport, strikeAt} from '../lib/hall-fx/1.0.0.js';
import {Interprete, REST, type Expr, type Palette, type Pose} from '../lib/interprete/1.0.0.js';

const POSE_KEYS = Object.keys(REST) as (keyof Pose)[];
const EXPR_KEYS = ['li', 'lo', 'ri', 'ro', 'sm'] as const;

/** Keyframes held until the next one, blended into it over `blend` seconds (smootherstep). */
function keyed<T extends Record<string, number>>(keys: readonly string[], frames: {at: number; value: T}[], t: number, blend: number): T {
  let out = frames[0]!.value;
  for (let i = 1; i < frames.length; i++) {
    if (t < frames[i]!.at) break;
    const prev = frames[i - 1]!.value, next = frames[i]!.value, k = ramp(t, frames[i]!.at, frames[i]!.at + blend);
    out = Object.fromEntries(keys.map((key) => [key, mix(prev[key]!, next[key]!, k)])) as T;
  }
  return out;
}

interface Mouth {energy: {rate: number; values: number[]}; speech: [number, number][]; from: number; to: number}

const Actor: KitVersion['component'] = ({props}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const camera = props.camera as Camera;
  const fl = strikeAt(t, (props.flash as {strikes: number[]}).strikes);
  const blackout = props.blackout as Envelope | undefined;
  const bo = blackout ? envelope(t, blackout) : 0;
  const x = props.x as number;
  const footY = (props.footY as number | undefined) ?? 1800;
  const scale = (props.scale as number | undefined) ?? 0.95;
  const poses = [...(props.poses as {at: number; pose: Pose}[])].sort((a, b) => a.at - b.at).map((p) => ({at: p.at, value: p.pose as unknown as Record<string, number>}));
  const expressions = [...(props.expressions as {at: number; ex: Expr}[])].sort((a, b) => a.at - b.at).map((e) => ({at: e.at, value: e.ex as unknown as Record<string, number>}));
  const gazes = (props.gaze as {from: number; to: number; x: number; y: number; h: number}[] | undefined) ?? [];
  const blinks = (props.blinks as number[] | undefined) ?? [];
  const liveW = props.live as {from: number; to: number};
  const bow = props.bow as {from: number; to: number};
  const mouthP = props.mouth as Mouth;
  const tp = (props.teleport as {in?: {at: number; dur: number}; out?: {at: number; dur: number}} | undefined) ?? {};

  const pose = (poses.length ? keyed(POSE_KEYS, poses, t, 0.6) : REST) as unknown as Pose;
  const ex = (expressions.length ? keyed(EXPR_KEYS, expressions, t, 0.5) : undefined) as unknown as Expr | undefined;
  const gaze = gazes.reduce((g, w) => {
    const k = win(t, w.from, w.to);
    return {x: g.x + w.x * k, y: g.y + w.y * k, h: g.h + w.h * k};
  }, {x: 0, y: 0, h: 0});
  const thanks = pulse(t, bow.from, bow.to);
  const live = ramp(t, liveW.from, liveW.to);
  const e = mouthP.energy.values.length ? mouthP.energy.values : [0];
  const ei = Math.round(t * mouthP.energy.rate);
  const speaking = t >= mouthP.from && t < mouthP.to && mouthP.speech.some(([a, b]) => t >= a && t <= b);
  const speech = speaking ? [-2, -1, 0, 1, 2].reduce((v, k) => v + (e[Math.max(0, Math.min(ei + k, e.length - 1))] || 0), 0) / 5 : 0;
  const mouth = Math.min(9, Math.max(0, speech - 0.045) * 12);
  const blink = blinks.reduce((v, a) => v + Math.sin(Math.PI * clamp((t - a) / 0.2)) ** 2, 0);
  const ax = x + 5 * Math.sin((2 * Math.PI * t) / 8.5) * scale * live;
  const tin = tp.in ? 1 - ease(clamp((t - tp.in.at) / tp.in.dur)) : 0;
  const tout = tp.out ? ease(clamp((t - tp.out.at) / tp.out.dur)) : 0;
  const holo = Math.max(tin, tout);
  const FY = footY;
  const figure = (
    <Interprete t={t} variant={props.variant as 'attore' | 'attrice'} outfit={props.outfit as 'gilet' | 'giacca' | undefined} hairstyle={props.hairstyle as 'coda' | 'corto' | undefined}
      accessories={props.accessories as {earrings?: boolean; freckles?: boolean} | undefined} palette={props.palette as Palette} pose={pose} {...(ex ? {ex} : {})} gaze={gaze}
      mouth={mouth} blink={blink} thanks={thanks} live={live} x={ax} y={FY - 641 * scale} scale={scale} />
  );
  if (bo >= 0.97) return null;
  return (
    <AbsoluteFill style={cameraStyle(t, camera)}>
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, opacity: (1 - bo) ** 2}}>
        <defs>
          <filter id="actorSil" x="-50%" y="-50%" width="200%" height="200%"><feColorMatrix type="matrix" values="0 0 0 0 .06  0 0 0 0 .08  0 0 0 0 .2  0 0 0 1 0" /><feGaussianBlur stdDeviation="7" /></filter>
          <filter id="actorRefl"><feGaussianBlur stdDeviation="2" /></filter>
          <filter id="actorContact"><feGaussianBlur stdDeviation="5" /></filter>
          <linearGradient id="actorFade" gradientUnits="userSpaceOnUse" x1="0" y1={FY} x2="0" y2={FY + 140}><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <mask id="actorReflMask"><rect x="0" y={FY - 4} width="1080" height="400" fill="url(#actorFade)" /></mask>
          <filter id="actorLit" x="-40%" y="-20%" width="180%" height="140%">
            <feComponentTransfer in="SourceGraphic" result="lit"><feFuncR type="linear" slope={1 + fl * 0.7} /><feFuncG type="linear" slope={1 + fl * 0.75} /><feFuncB type="linear" slope={1 + fl * 0.85} /></feComponentTransfer>
            <feGaussianBlur in="SourceAlpha" stdDeviation={6 + 6 * fl} result="halo" /><feFlood floodColor="#ffffff" floodOpacity={0.1 + 0.45 * fl} />
            <feComposite in2="halo" operator="in" result="glow" /><feMerge><feMergeNode in="glow" /><feMergeNode in="lit" /></feMerge>
          </filter>
        </defs>
        {holo < 1 && (
          <g opacity={1 - holo}>
            <g opacity=".22" transform={`translate(${ax} ${FY}) skewX(-30) scale(1 -.3) translate(${-ax} ${-FY})`}><g filter="url(#actorSil)">{figure}</g></g>
            <ellipse cx={ax + 6} cy={FY - 2} rx="78" ry="10" fill="#1a2250" opacity=".35" filter="url(#actorContact)" />
            <g mask="url(#actorReflMask)"><g opacity=".22" filter="url(#actorRefl)" transform={`translate(0 ${FY}) scale(1 -.6) translate(0 ${-FY})`}>{figure}</g></g>
          </g>
        )}
        {holo <= 0 ? <g filter="url(#actorLit)">{figure}</g> : holo < 1 && <Teleport t={t} k={holo} x={ax} h={641 * scale} w={300 * scale} floorY={FY}>{figure}</Teleport>}
      </svg>
    </AbsoluteFill>
  );
};

const PoseSchema = z.object(Object.fromEntries(POSE_KEYS.map((k) => [k, z.number()])) as Record<keyof Pose, z.ZodNumber>).strict();
const ExprSchema = z.object({li: z.number(), lo: z.number(), ri: z.number(), ro: z.number(), sm: z.number()}).strict();
const Window = z.object({from: z.number(), to: z.number()}).strict();
const color = z.string().min(1);
const PaletteSchema = z.object({ink: color, shirt: color, shirtDark: color, vest: color, vestLight: color, button: color, inner: color, innerDark: color, skin: color, skinDark: color, trousers: color, shoe: color, sole: color, hair: color.optional(), hairHi: color.optional(), hairGloss: color.optional(), lip: color.optional(), freckles: color.optional()}).strict();

const Props = z.object({
  variant: z.enum(['attore', 'attrice']),
  outfit: z.enum(['gilet', 'giacca']).optional(),
  hairstyle: z.enum(['coda', 'corto']).optional(),
  accessories: z.object({earrings: z.boolean().optional(), freckles: z.boolean().optional()}).strict().optional(),
  palette: PaletteSchema,
  x: z.number(),
  footY: z.number().positive().optional(),
  scale: z.number().positive().optional(),
  /** Full poses at their instants, blended over 0.6 s; the first holds from the start. */
  poses: z.array(z.object({at: z.number(), pose: PoseSchema}).strict()).min(1),
  /** Expressions at their instants, blended over 0.5 s. */
  expressions: z.array(z.object({at: z.number(), ex: ExprSchema}).strict()).min(1),
  gaze: z.array(z.object({from: z.number(), to: z.number(), x: z.number(), y: z.number(), h: z.number()}).strict()).optional(),
  blinks: z.array(z.number()).optional(),
  /** The figure comes alive over this window (still before). */
  live: Window,
  /** The bow, in and out over 0.9 s at each end. */
  bow: Window,
  /** The mouth follows the voice's energy (samples per second) while it speaks within [from, to). */
  mouth: z.object({energy: z.object({rate: z.number().positive(), values: z.array(z.number().min(0))}).strict(), speech: z.array(z.tuple([z.number(), z.number()])), from: z.number(), to: z.number()}).strict(),
  teleport: z.object({in: z.object({at: z.number(), dur: z.number().positive()}).strict().optional(), out: z.object({at: z.number(), dur: z.number().positive()}).strict().optional()}).strict().optional(),
  camera: CameraSchema,
  flash: FlashSchema,
  blackout: EnvelopeSchema.optional(),
}).strict();

const REST_POSE = {lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0};
const sample = (extra: Record<string, unknown> = {}) => ({
  variant: 'attore',
  outfit: 'gilet',
  palette: {ink: '#2e2620', shirt: '#eef2ff', shirtDark: '#c3cbe8', vest: '#eef2ff', vestLight: '#ffffff', button: '#5fdcff', inner: '#ffbf5e', innerDark: '#e09a2e', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#283066', shoe: '#fafaf5', sole: '#dcd8cc'},
  x: 770,
  poses: [{at: 0, pose: REST_POSE}, {at: 3, pose: {...REST_POSE, lu: 20, lf: 54, ru: 20, rf: 54, head: -2, step: 1}}, {at: 6, pose: {...REST_POSE, ru: 126, rf: 140, head: 4}}],
  expressions: [{at: 0, ex: {li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25}}, {at: 3, ex: {li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9}}],
  gaze: [{from: 4, to: 5.4, x: 3.5, y: -3, h: 5}],
  blinks: [1.1, 3.6, 6.2],
  live: {from: 1, to: 1.8},
  bow: {from: 8.5, to: 10.7},
  mouth: {energy: {rate: 30, values: Array.from({length: 330}, (_, i) => 0.05 + 0.25 * Math.abs(Math.sin(i / 2.3)))}, speech: [[2, 8]], from: 2, to: 8},
  teleport: {in: {at: 0.35, dur: 1}, out: {at: 9.8, dur: 0.95}},
  camera: {origin: [600, 1100], zoom: [{from: 2, to: 9, rampIn: 6, rampOut: 1.4, amount: 0.025}], shake: []},
  flash: {strikes: [5.2]},
  ...extra,
});

export const kit: KitVersion = {
  name: 'interprete',
  version: '1.0.0',
  description: "The poem's SVG actor in a 9:16 museum hall: poses, expressions, gaze, blinks and a mouth that follows the voice, its shadow and reflection, the lightning on it, the blackout, the bow, the teleport in and out — in the hall's shared camera.",
  profiles: ['vertical-1080x1920'],
  props: Props,
  component: Actor,
  examples: [
    {id: 'reciting', props: sample(), durationInFrames: 330, frame: 120},
    {id: 'teleport-in', props: sample(), durationInFrames: 330, frame: 25},
    {id: 'pointing-lit', props: sample(), durationInFrames: 330, frame: 157},
    {id: 'bow', props: sample(), durationInFrames: 330, frame: 285},
  ],
};
