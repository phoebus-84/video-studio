// room-effect@1.0.0 — released: never edit this file; add room-effect/<next>.tsx instead.
// One named effect living in the museum hall (CreativeStudio's roomFx): fog
// pouring over the floor, steam, the notes of a whistle, birds, falling
// leaves, ribbons of light, a cut-out figure coming out of the picture
// (apparizione) or a ghost. Drawn in the hall's shared camera, around its
// screen, hidden by the blackout. Effects that stay in the hall fade in over
// 0.6 s and out over 0.8 s; figures make their own entrance and exit.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {envelope, ramp, type Envelope} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, EnvelopeSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {ROOM_FX, roomFx, type Box, type FigureOpt, type RoomFx} from '../lib/hall-fx/1.0.0.js';

/** Figures and notes come out in front of the screen and keep their own timing. */
const FRONT: ReadonlySet<RoomFx> = new Set<RoomFx>(['note', 'apparizione', 'fantasma']);

const RoomEffect: KitVersion['component'] = ({props}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const effect = props.effect as RoomFx;
  const start = (props.start as number | undefined) ?? 0;
  const end = props.end as number;
  const blackout = props.blackout as Envelope | undefined;
  const bo = blackout ? envelope(t, blackout) : 0;
  const figure = (props.figure as FigureOpt | undefined) ?? {};
  const drawn = roomFx(effect, {t, t0: start, t1: end, frame: props.screen as Box, color: (props.color as string | undefined) ?? '#ffffff', textures: (props.textures as {fog?: string} | undefined) ?? {}, figure});
  const o = FRONT.has(effect) ? 1 : ramp(t, start, start + 0.6) * (1 - ramp(t, end - 0.8, end));
  if (o <= 0 || bo >= 1) return null;
  return (
    <AbsoluteFill style={cameraStyle(t, props.camera as Camera)}>
      <AbsoluteFill style={{opacity: o * (1 - bo)}}>{drawn}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const Props = z.object({
  effect: z.enum(ROOM_FX),
  color: z.string().min(1).optional(),
  /** When the effect starts and ends, in seconds from the item's start. */
  start: z.number().min(0).optional(),
  end: z.number().positive(),
  screen: BoxSchema,
  camera: CameraSchema,
  blackout: EnvelopeSchema.optional(),
  textures: z.object({fog: AssetUrl.optional()}).strict().optional(),
  /** For apparizione and fantasma: the cut-out, where it settles (x, y, w), how it moves and leaves; for note: where the notes fly (x, y). */
  figure: z.object({
    src: AssetUrl.optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().positive().optional(),
    mode: z.enum(['sale', 'salpa', 'scende']).optional(),
    exit: z.enum(['rientra', 'svanisce']).optional(),
    glow: z.string().min(1).optional(),
  }).strict().optional(),
}).strict().superRefine((p, ctx) => {
  if (p.effect === 'apparizione' && !p.figure?.src) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['figure', 'src'], message: 'an apparizione needs its cut-out'});
  if (p.effect === 'nebbia-sala' && !p.textures?.fog) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['textures', 'fog'], message: 'nebbia-sala draws with the fog texture'});
});

const base = {screen: {x: 360, y: 215, w: 620, h: 910}, camera: {origin: [600, 1100], zoom: [], shake: []}};
export const kit: KitVersion = {
  name: 'room-effect',
  version: '1.0.0',
  description: 'One named effect in a 9:16 museum hall — fog over the floor, steam, notes, birds, leaves, ribbons of light, a figure or a ghost coming out of the picture — in the shared camera.',
  profiles: ['vertical-1080x1920'],
  props: Props,
  component: RoomEffect,
  examples: [
    {id: 'apparizione', props: {...base, effect: 'apparizione', end: 7, figure: {src: {$asset: 'figure'}, x: 190, y: 760, w: 360, mode: 'sale', exit: 'rientra', glow: '#ff6a8a'}}, samples: {figure: 'figure.png'}, durationInFrames: 240, frame: 90},
    {id: 'nebbia-sala', props: {...base, effect: 'nebbia-sala', end: 6, color: '#dfe8ff', textures: {fog: {$asset: 'fog'}}}, samples: {fog: 'fog.png'}, durationInFrames: 180, frame: 90},
    {id: 'incanto', props: {...base, effect: 'incanto', end: 5, color: '#ffb347'}, durationInFrames: 150, frame: 60},
    {id: 'note', props: {...base, effect: 'note', end: 5, color: '#ffd38a', figure: {x: 230, y: 640}}, durationInFrames: 150, frame: 70},
    {id: 'fantasma', props: {...base, effect: 'fantasma', end: 7, figure: {x: 250, y: 900, w: 330, exit: 'svanisce', glow: '#dfe6ff'}}, durationInFrames: 210, frame: 100},
    {id: 'vapore', props: {...base, effect: 'vapore', end: 5, color: '#c2185b'}, durationInFrames: 150, frame: 60},
    {id: 'uccelli', props: {...base, effect: 'uccelli', end: 6}, durationInFrames: 180, frame: 75},
    {id: 'foglie', props: {...base, effect: 'foglie', end: 6}, durationInFrames: 180, frame: 75},
  ],
};
