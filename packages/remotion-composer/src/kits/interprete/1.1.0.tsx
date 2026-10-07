// interprete@1.1.0 — released: never edit this file; add interprete/<next>.tsx instead.
// A character of a 16:9 lesson — the guide, the actor — from the channel
// theme: the SVG interprete with its poses, expressions, gaze, blinks and a
// mouth that follows the voice, standing on the floor with its shadow and
// reflection, lit by a flash, teleporting in and out (the hologram exit),
// changing costume on a flash (from CreativeStudio's poesie-museo-long guide
// and actor). 1.1.0: channel-neutral — the character and the look are props
// (ADR-0040) — and drawn for 16:9; 1.0.0 stays the short's.
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, type Look} from '../lib/look/1.0.0.js';
import {clamp, ease, mix, pulse, ramp, win} from '../lib/stage-math/1.0.0.js';
import {CameraSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Teleport, strikeAt} from '../lib/lesson-stage/1.0.0.js';
import {Interprete, REST, type Expr, type Palette, type Pose} from '../lib/interprete/1.0.0.js';

const POSE_KEYS = Object.keys(REST) as (keyof Pose)[];
const EXPR_KEYS = ['li', 'lo', 'ri', 'ro', 'sm'] as const;
const sid = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

/** Keyframes held until the next one, blended into it over `blend` seconds. */
function keyed<T extends Record<string, number>>(keys: readonly string[], frames: {at: number; value: T}[], t: number, blend: number): T {
  let out = frames[0]!.value;
  for (let i = 1; i < frames.length; i++) {
    if (t < frames[i]!.at) break;
    const prev = frames[i - 1]!.value;
    const next = frames[i]!.value;
    const k = ramp(t, frames[i]!.at, frames[i]!.at + blend);
    out = Object.fromEntries(keys.map((key) => [key, mix(prev[key]!, next[key]!, k)])) as T;
  }
  return out;
}

interface Character {variant: 'attore' | 'attrice'; outfit?: 'gilet' | 'giacca'; hairstyle?: 'coda' | 'corto'; accessories?: {earrings?: boolean; freckles?: boolean}; palette: Palette}
interface Mouth {energy: {rate: number; values: number[]}; speech: [number, number][]; from: number; to: number}

const Figure: KitVersion['component'] = ({props}) => {
  const id = sid(useId());
  const look = props.look as Look;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const fl = strikeAt(t, ((props.flash as {strikes: number[]} | undefined) ?? {strikes: []}).strikes);
  const x = props.x as number;
  const FY = (props.footY as number | undefined) ?? 950;
  const scale = (props.scale as number | undefined) ?? 0.78;
  const costume = props.costume as {at: number; character: Character} | undefined;
  const ch = costume && t >= costume.at ? costume.character : (props.character as Character);
  // the change happens on a flash of its own
  const change = costume ? strikeAt(t, [costume.at - 0.06]) : 0;
  const lit = Math.max(fl, change);
  const poses = [...(props.poses as {at: number; pose: Pose}[])].sort((a, b) => a.at - b.at).map((p) => ({at: p.at, value: p.pose as unknown as Record<string, number>}));
  const expressions = [...((props.expressions as {at: number; ex: Expr}[] | undefined) ?? [])].sort((a, b) => a.at - b.at).map((e) => ({at: e.at, value: e.ex as unknown as Record<string, number>}));
  const gazes = (props.gaze as {from: number; to: number; x: number; y: number; h: number}[] | undefined) ?? [];
  const blinks = (props.blinks as number[] | undefined) ?? [];
  const bow = props.bow as {from: number; to: number} | undefined;
  const m = props.mouth as Mouth | undefined;
  const tp = (props.teleport as {in?: {at: number; dur: number}; out?: {at: number; dur: number}} | undefined) ?? {};

  const pose = keyed(POSE_KEYS, poses, t, 0.6) as unknown as Pose;
  const ex = expressions.length ? (keyed(EXPR_KEYS, expressions, t, 0.5) as unknown as Expr) : undefined;
  const gaze = gazes.reduce((g, w) => {
    const k = win(t, w.from, w.to);
    return {x: g.x + w.x * k, y: g.y + w.y * k, h: g.h + w.h * k};
  }, {x: 0, y: 0, h: 0});
  const e = m && m.energy.values.length ? m.energy.values : [0];
  const ei = m ? Math.round(t * m.energy.rate) : 0;
  const speaking = !!m && t >= m.from && t < m.to && m.speech.some(([a, b]) => t >= a && t <= b);
  const speech = speaking ? [-2, -1, 0, 1, 2].reduce((v, k) => v + (e[Math.max(0, Math.min(ei + k, e.length - 1))] || 0), 0) / 5 : 0;
  const mouth = Math.min(9, Math.max(0, speech - 0.045) * 12);
  const blink = blinks.reduce((v, a) => v + Math.sin(Math.PI * clamp((t - a) / 0.2)) ** 2, 0);
  const tin = tp.in ? 1 - ease(clamp((t - tp.in.at) / tp.in.dur)) : 0;
  const tout = tp.out ? ease(clamp((t - tp.out.at) / tp.out.dur)) : 0;
  const holo = Math.max(tin, tout);
  const figure = (
    <Interprete t={t} variant={ch.variant} outfit={ch.outfit} hairstyle={ch.hairstyle} accessories={ch.accessories} palette={ch.palette} pose={pose} {...(ex ? {ex} : {})} gaze={gaze}
      mouth={mouth} blink={blink} thanks={bow ? pulse(t, bow.from, bow.to) : 0} live={1} x={x} y={FY - 641 * scale} scale={scale} />
  );
  const camera = props.camera as Camera | undefined;
  return (
    <AbsoluteFill style={camera ? cameraStyle(t, camera) : undefined}>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0}}>
        <defs>
          <filter id={`${id}lit`} x="-40%" y="-20%" width="180%" height="140%">
            <feComponentTransfer in="SourceGraphic" result="lit"><feFuncR type="linear" slope={1 + lit * 0.8} /><feFuncG type="linear" slope={1 + lit * 0.85} /><feFuncB type="linear" slope={1 + lit * 0.9} /></feComponentTransfer>
            <feGaussianBlur in="SourceAlpha" stdDeviation={6 + 6 * lit} result="halo" />
            <feFlood floodColor={look.colors.glow} floodOpacity={0.12 + 0.5 * lit} />
            <feComposite in2="halo" operator="in" result="glow" />
            <feMerge><feMergeNode in="glow" /><feMergeNode in="lit" /></feMerge>
          </filter>
          <linearGradient id={`${id}rf`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".28" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <mask id={`${id}m`}><rect x={x - 400} y={FY} width={800} height={400} fill={`url(#${id}rf)`} /></mask>
        </defs>
        {holo < 1 && (
          <g opacity={1 - holo}>
            <ellipse cx={x + 10} cy={FY} rx={150 * scale} ry={18} fill={look.colors.backdrop} opacity=".28" />
            <g mask={`url(#${id}m)`}><g transform={`translate(0 ${2 * FY}) scale(1 -1)`} opacity=".5">{figure}</g></g>
          </g>
        )}
        {holo <= 0 ? <g filter={`url(#${id}lit)`}>{figure}</g> : holo < 1 && <Teleport look={look} t={t} k={holo} x={x} h={641 * scale} w={300 * scale} floorY={FY}>{figure}</Teleport>}
      </svg>
    </AbsoluteFill>
  );
};

const PoseSchema = z.object(Object.fromEntries(POSE_KEYS.map((k) => [k, z.number()])) as Record<keyof Pose, z.ZodNumber>).strict();
const ExprSchema = z.object({li: z.number(), lo: z.number(), ri: z.number(), ro: z.number(), sm: z.number()}).strict();
const color = z.string().min(1);
const PaletteSchema = z.object({ink: color, shirt: color, shirtDark: color, vest: color, vestLight: color, button: color, inner: color, innerDark: color, skin: color, skinDark: color, trousers: color, shoe: color, sole: color, hair: color.optional(), hairHi: color.optional(), hairGloss: color.optional(), lip: color.optional(), freckles: color.optional()}).strict();
const CharacterSchema = z.object({
  variant: z.enum(['attore', 'attrice']),
  outfit: z.enum(['gilet', 'giacca']).optional(),
  hairstyle: z.enum(['coda', 'corto']).optional(),
  accessories: z.object({earrings: z.boolean().optional(), freckles: z.boolean().optional()}).strict().optional(),
  palette: PaletteSchema,
}).strict();
const Window = z.object({from: z.number(), to: z.number()}).strict();
const Moment = z.object({at: z.number(), dur: z.number().positive()}).strict();

const REST_POSE = {lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0};
const GUIDE = {
  variant: 'attrice', outfit: 'gilet',
  palette: {ink: '#2e2620', shirt: '#e9edf8', shirtDark: '#c9d0e6', vest: '#3a3f4f', vestLight: '#5a6175', button: '#4f9dff', inner: '#e9edf8', innerDark: '#c9d0e6', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#22252e', shoe: '#fafaf5', sole: '#dcd8cc', hair: '#3b2216', hairHi: '#6e4127', hairGloss: '#a06a43'},
};
const ACTOR = {variant: 'attore', outfit: 'gilet', palette: {...GUIDE.palette, vest: '#4f9dff', vestLight: '#8fc0ff'}};
const sample = (extra: Record<string, unknown> = {}) => ({
  look: DEMO_LOOK,
  character: GUIDE,
  x: 1700,
  poses: [{at: 0, pose: REST_POSE}, {at: 1.5, pose: {...REST_POSE, ru: 126, rf: 140, head: 4}}, {at: 4, pose: {...REST_POSE, lu: 56, lf: 72, ru: 56, rf: 72, head: -4, step: 1}}],
  expressions: [{at: 0, ex: {li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25}}, {at: 2, ex: {li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9}}],
  blinks: [1.1, 3.6],
  mouth: {energy: {rate: 30, values: Array.from({length: 180}, (_, i) => 0.05 + 0.25 * Math.abs(Math.sin(i / 2.3)))}, speech: [[0.5, 5.5]], from: 0.5, to: 5.5},
  ...extra,
});

export const kit: KitVersion = {
  name: 'interprete',
  version: '1.1.0',
  description: "A character of a 16:9 lesson from the channel theme — the guide, the actor: the SVG interprete's poses, expressions, gaze, blinks and a mouth that follows the voice, its shadow and reflection, lit by a flash, teleporting in and out, changing costume on a flash.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    character: CharacterSchema,
    x: z.number(),
    footY: z.number().positive().optional(),
    scale: z.number().positive().optional(),
    /** Full poses at their instants (seconds from the item's start), blended over 0.6 s. */
    poses: z.array(z.object({at: z.number(), pose: PoseSchema}).strict()).min(1),
    expressions: z.array(z.object({at: z.number(), ex: ExprSchema}).strict()).optional(),
    gaze: z.array(z.object({from: z.number(), to: z.number(), x: z.number(), y: z.number(), h: z.number()}).strict()).optional(),
    blinks: z.array(z.number()).optional(),
    bow: Window.optional(),
    mouth: z.object({energy: z.object({rate: z.number().positive(), values: z.array(z.number().min(0))}).strict(), speech: z.array(z.tuple([z.number(), z.number()])), from: z.number(), to: z.number()}).strict().optional(),
    /** In: it appears out of a column of light; out: it dissolves into one (the hologram exit). */
    teleport: z.object({in: Moment.optional(), out: Moment.optional()}).strict().optional(),
    /** From `at` it wears another costume, changed on a flash. */
    costume: z.object({at: z.number(), character: CharacterSchema}).strict().optional(),
    flash: z.object({strikes: z.array(z.number())}).strict().optional(),
    camera: CameraSchema.optional(),
  }).strict(),
  component: Figure,
  examples: [
    {id: 'pointing', props: sample(), durationInFrames: 180, frame: 75},
    {id: 'teleport-in', props: sample({teleport: {in: {at: 0, dur: 1.2}}}), durationInFrames: 180, frame: 18},
    {id: 'hologram-exit', props: sample({teleport: {out: {at: 4, dur: 1.2}}}), durationInFrames: 180, frame: 138},
    {id: 'costume', props: sample({character: ACTOR, x: 1720, scale: 0.82, costume: {at: 2, character: {...ACTOR, palette: {...ACTOR.palette, vest: '#ffd166', vestLight: '#ffe29a'}}}}), durationInFrames: 180, frame: 63},
    {id: 'closeup', props: sample({camera: {origin: [1700, 300], zoom: [{from: 0, to: 6, rampIn: 0.45, rampOut: 0.45, amount: 1}], shake: []}}), durationInFrames: 180, frame: 60},
  ],
};
