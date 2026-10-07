// room@1.0.0 — released: never edit this file; add room/<next>.tsx instead.
// A room of a 16:9 lesson from the channel theme: its picture under a slow
// drifting camera, a distant storm in its sky regions (rare, slow bolts;
// quiet where the timeline asks, as at the loop's first and last frames),
// its windows and floor lit by a flash, its doors glowing, a monitor that
// plays a clip (from CreativeStudio's poesie-museo-long Sala and atrium).
// Channel-neutral: the room and the look are props (ADR-0040).
import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {ease, ramp} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {DistantStorm, LoopClip, strikeAt, type Box, type Point, type Sky} from '../lib/lesson-stage/1.0.0.js';

interface RoomProps {
  image: string;
  sky?: Sky[];
  windows?: Point[][];
  doors?: Box[];
  monitor?: {box: Box; video: string};
}
const polygon = (poly: Point[]) => `polygon(${poly.map(([x, y]) => `${x}px ${y}px`).join(',')})`;

const Room: KitVersion['component'] = ({props, context}) => {
  const look = props.look as Look;
  const c = look.colors;
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const end = durationInFrames / fps;
  const room = props.room as RoomProps;
  const fl = strikeAt(t, ((props.flash as {strikes: number[]} | undefined) ?? {strikes: []}).strikes);
  const quiet = (props.quiet as [number, number][] | undefined) ?? [];
  // how far from quiet: 0 inside a quiet window, ramping over 0.6 s at its inner edges only —
  // a window that starts at the item's start (or ends at its end) is quiet right there
  const notQuiet = quiet.reduce((v, [a, b]) => v * (1 - (a <= 0 ? 1 : ramp(t, a, a + 0.6)) * (b >= end ? 1 : 1 - ramp(t, b - 0.6, b)) * (t >= a && t <= b ? 1 : 0)), 1);
  const calm = (props.lightning ?? true) ? notQuiet : 0;
  const dark = (props.dark as number | undefined) ?? 0;
  const push = props.push as {at: number; dur: number; scale: number; origin: Point} | undefined;
  const drift = (props.drift ?? true) ? 1 : 0;
  const z0 = 1 + drift * (0.04 + 0.012 * Math.sin(t * 0.05));
  const pk = push ? ease((t - push.at) / push.dur) : 0;
  const scale = z0 * (1 + (push ? push.scale - 1 : 0) * pk);
  // one origin for the whole item: switching it when the push starts would make the picture jump
  const origin = push ? push.origin : [960, 520];
  const camera = props.camera as Camera | undefined;
  return (
    <AbsoluteFill style={{overflow: 'hidden', background: c.backdrop}}>
      <AbsoluteFill style={camera ? cameraStyle(t, camera) : undefined}>
      <div style={{position: 'absolute', inset: 0, transform: `scale(${scale}) translateX(${drift * Math.sin(t * 0.04) * 8}px)`, transformOrigin: `${origin[0]}px ${origin[1]}px`}}>
        <Img src={room.image} style={{position: 'absolute', inset: 0, width: 1920, height: 1080, filter: `brightness(${1.04 + fl * 0.3 - dark * 0.8}) saturate(1.05)`}} />
        {room.monitor ? (
          <>
            <LoopClip src={room.monitor.video} box={room.monitor.box} live={notQuiet} frames={context.assetFrames[room.monitor.video]} />
            <div style={{position: 'absolute', left: room.monitor.box.x - 40, top: room.monitor.box.y - 40, width: room.monitor.box.w + 80, height: room.monitor.box.h + 80, background: `radial-gradient(closest-side, ${alpha(c.accent, 0.32)}, ${alpha(c.accent, 0)})`, mixBlendMode: 'screen'}} />
          </>
        ) : null}
        {(room.windows ?? []).map((poly, i) => <div key={i} style={{position: 'absolute', inset: 0, clipPath: polygon(poly), background: alpha(c.glow, fl * 0.75), mixBlendMode: 'screen'}} />)}
        {(room.doors ?? []).map((d, i) => <div key={i} style={{position: 'absolute', left: d.x - 60, top: d.y - 60, width: d.w + 120, height: d.h + 120, background: `radial-gradient(closest-side, ${alpha(c.lightning, 0.3 + fl * 0.6)}, ${alpha(c.lightning, 0)})`, mixBlendMode: 'screen'}} />)}
        <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
          {(room.sky ?? []).map((sky, i) => <DistantStorm key={i} look={look} t={t} sky={sky} calm={calm} />)}
        </svg>
      </div>
      <div style={{position: 'absolute', inset: 0, background: `radial-gradient(1300px 900px at 8% 32%, ${alpha(c.glow, fl * 0.55)}, ${alpha(c.glow, 0)} 70%)`, mixBlendMode: 'screen'}} />
      <div style={{position: 'absolute', left: 0, right: 0, top: 640, bottom: 0, background: `linear-gradient(100deg, ${alpha(c.glow, fl * 0.45)}, ${alpha(c.glow, 0)} 55%)`, mixBlendMode: 'screen'}} />
      {dark > 0 ? <div style={{position: 'absolute', inset: 0, background: alpha(c.backdrop, dark * 0.82)}} /> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const PointSchema = z.tuple([z.number(), z.number()]);
const SAMPLE_ROOM = {
  image: {$asset: 'room'},
  sky: [{poly: [[0, 0], [660, 262], [660, 540], [0, 492]], period: 3, seed: 3}],
  windows: [[[0, 0], [660, 170], [660, 600], [0, 760]]],
  doors: [{x: 1250, y: 300, w: 200, h: 420}],
};

export const kit: KitVersion = {
  name: 'room',
  version: '1.0.0',
  description: 'A room of a 16:9 lesson from the channel theme: its picture under a slow camera, a distant storm in its sky, windows and floor lit by a flash, glowing doors, a monitor playing a clip.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    room: z.object({
      image: AssetUrl,
      sky: z.array(z.object({poly: z.array(PointSchema).min(3), period: z.number().min(1.6).optional(), seed: z.number().int().min(0).optional(), scale: z.number().positive().optional()}).strict()).optional(),
      windows: z.array(z.array(PointSchema).min(3)).optional(),
      doors: z.array(BoxSchema).optional(),
      monitor: z.object({box: BoxSchema, video: AssetUrl}).strict().optional(),
    }).strict(),
    /** The distant storm: on unless false; off over each quiet window (seconds from the item's start), ramping over 0.6 s inside the item; the monitor's clip holds still there too. */
    lightning: z.boolean().optional(),
    quiet: z.array(z.tuple([z.number(), z.number()])).optional(),
    flash: z.object({strikes: z.array(z.number())}).strict().optional(),
    /** The slow drift of the camera, on unless false; a push towards a point (the door one walks through). */
    drift: z.boolean().optional(),
    push: z.object({at: z.number(), dur: z.number().positive(), scale: z.number().min(1).max(4), origin: PointSchema}).strict().optional(),
    dark: z.number().min(0).max(1).optional(),
    /** The scene's camera, shared with the panel and the characters (a close-up). */
    camera: CameraSchema.optional(),
  }).strict(),
  component: Room,
  examples: [
    {id: 'storm', props: {look: DEMO_LOOK, room: SAMPLE_ROOM}, samples: {room: 'room-16x9.png'}, durationInFrames: 150, frame: 100},
    {id: 'flash', props: {look: DEMO_LOOK, room: SAMPLE_ROOM, flash: {strikes: [1]}}, samples: {room: 'room-16x9.png'}, durationInFrames: 60, frame: 32},
    {id: 'monitor', props: {look: DEMO_LOOK, room: {image: {$asset: 'room'}, monitor: {box: {x: 1316, y: 541, w: 154, h: 111}, video: {$asset: 'clip'}}}, quiet: [[-1, 0.5]]}, samples: {room: 'room-16x9.png', clip: 'clip.mp4'}, durationInFrames: 60, frame: 40},
    {id: 'push', props: {look: DEMO_LOOK, room: SAMPLE_ROOM, push: {at: 0, dur: 1.5, scale: 1.8, origin: [1350, 510]}, lightning: false}, samples: {room: 'room-16x9.png'}, durationInFrames: 60, frame: 40},
  ],
};
