// museum-hall@1.0.0 — released: never edit this file; add museum-hall/<next>.tsx instead.
// The hall of "Dentro i versi · short" (CreativeStudio's sala8): the room, the
// glass installation screen with the poem's pictures and their slow camera,
// the pictures' effects inside the screen and out in the hall, the lightning,
// the lights per stanza and the dark with its pools of light (on the screen
// and on the actor), the pedestal, wind, shatter, and the blackout with its
// bolt. Everything inside the hall moves with the shared camera.
import React from 'react';
import {AbsoluteFill, Img, interpolateColors, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {clamp, ease, envelope, maxOf, mix, ramp, rnd2, type Envelope} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, EnvelopeSchema, FlashSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Glass, LiveBolt, PICTURE_FX, Shatter, pictureCamera, pictureFx, pictureFxInRoom, strikeAt, type Box, type PictureFx} from '../lib/hall-fx/1.0.0.js';
import {HALL} from '../lib/dentro-i-versi/1.0.0.js';

interface Picture {src: string; at: number; scale: number; origin: string; move: {dx: number; dy: number; z: number; r: number}; fx: PictureFx[]; spill: string}
interface Light {at: number; dark: number; spot: string; w: number}

/** Wind through the hall: streaks and leaves crossing to the right. */
const WindIn: React.FC<{t: number; k: number}> = ({t, k}) => {
  if (k <= 0) return null;
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, opacity: Math.min(1, k)}}>
      {Array.from({length: 12}, (_, i) => {
        const sp = 700 + rnd2(i * 3) * 700, len = 160 + rnd2(i * 5) * 280, x = ((rnd2(i * 7) * 1500 + t * sp) % 1500) - 200, y = 300 + rnd2(i * 11) * 1100, a = 16 * Math.sin(t * 2 + i);
        return <path key={i} d={`M${x} ${y} q ${len * 0.5} ${a} ${len} ${len * 0.08}`} stroke="#ffffff" strokeWidth={1.5 + rnd2(i) * 2.5} fill="none" strokeLinecap="round" opacity={0.25 + 0.45 * rnd2(i * 17)} />;
      })}
      {Array.from({length: 16}, (_, i) => {
        const sp = 420 + rnd2(i * 23) * 520, x = ((rnd2(i * 29) * 1500 + t * sp) % 1500) - 150, y = 260 + rnd2(i * 31) * 1250 + Math.sin(t * 3 + i) * 50;
        return <ellipse key={'l' + i} cx={x} cy={y} rx={13} ry={5.5} fill={i % 3 ? '#7fae6a' : '#c2a95a'} transform={`rotate(${(t * 360 * (1 + rnd2(i))) % 360} ${x} ${y})`} opacity=".9" />;
      })}
    </svg>
  );
};

const MuseumHall: KitVersion['component'] = ({props}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const fr = props.screen as Box;
  const pictures = props.pictures as Picture[];
  const camera = props.camera as Camera;
  const strikes = (props.flash as {strikes: number[]}).strikes;
  const lights = [...(props.lights as Light[])].sort((a, b) => a.at - b.at);
  const blackout = props.blackout as Envelope | undefined;
  const bolt = props.bolt as {at: number; dur: number} | undefined;
  const wind = (props.wind as Envelope[] | undefined) ?? [];
  const shatter = (props.shatter as {at: number; picture: number; dur: number}[] | undefined) ?? [];
  const actor = props.actor as {x: number; scale: number; liveFrom: number; liveTo: number};
  const textures = (props.textures as {fog?: string; caustics?: string} | undefined) ?? {};
  const iw = fr.w - 20;
  const ih = fr.h - 20;

  const fl = strikeAt(t, strikes);
  const lightAt = () => {
    let i = 0;
    while (i + 1 < lights.length && t >= lights[i + 1]!.at) i++;
    const a = lights[i]!, b = lights[Math.min(i + 1, lights.length - 1)]!;
    const k = b === a ? 0 : ease(clamp((t - a.at) / Math.max(0.01, b.at - a.at)));
    return {dark: 0.38 * mix(a.dark, b.dark, k), col: interpolateColors(k, [0, 1], [a.spot, b.spot]), tint: '#0a1030', w: mix(a.w, b.w, k)};
  };
  const lt = lightAt();
  const bo = blackout ? envelope(t, blackout) : 0;
  const dark = Math.max(lt.dark, bo);
  const pcx = fr.x + fr.w / 2, pcy = fr.y + fr.h / 2;
  const ax = actor.x + 5 * Math.sin((2 * Math.PI * t) / 8.5) * actor.scale * ramp(t, actor.liveFrom, actor.liveTo);
  const curSpill = pictures.reduce((c, p) => (t >= p.at ? p.spill : c), pictures[0]!.spill);
  const shatterOf = (i: number) => shatter.find((s) => s.picture === i);
  const qop = (i: number) => {
    const a = pictures[i]!.at, b = i < pictures.length - 1 ? pictures[i + 1]!.at : 1e9;
    const inn = i === 0 ? 1 : ease(clamp((t - a) / 0.8));
    const out = 1 - ease(clamp((t - b) / 0.8));
    const sh = shatterOf(i);
    return clamp(inn * out) * (sh && t >= sh.at ? 0 : 1);
  };
  const end = 1e9;
  return (
    <AbsoluteFill style={{background: '#0b1030', overflow: 'hidden'}}>
      <AbsoluteFill style={cameraStyle(t, camera)}>
        <Img src={props.room as string} style={{position: 'absolute', inset: 0, width: 1080, height: 1920, filter: `brightness(${1 + fl * 0.2})`}} />
        <AbsoluteFill style={{mixBlendMode: 'screen', background: `radial-gradient(ellipse 900px 1500px at ${pcx}px ${pcy}px, rgba(210,225,255,${fl * 0.6}), rgba(210,225,255,0) 72%)`}} />
        <div style={{position: 'absolute', left: 0, right: 0, top: 1100, bottom: 0, mixBlendMode: 'screen', background: `linear-gradient(100deg, rgba(220,232,255,${fl * 0.4}) 0%, rgba(220,232,255,0) 55%)`}} />
        <Glass box={fr} t={t} flash={fl}>
          {pictures.map((p, i) => {
            const o = qop(i);
            const next = i < pictures.length - 1 ? pictures[i + 1]!.at : p.at + 40;
            return o <= 0 ? null : (
              <div key={i} style={{position: 'absolute', inset: 0, opacity: o}}>
                <Img src={p.src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transformOrigin: p.origin, ...pictureCamera(t, p.at, next, i === 0, p.scale, p.move)}} />
                {p.fx.map((n) => <React.Fragment key={n}>{pictureFx(n, {t, t0: p.at, t1: end, frame: fr, color: p.spill, textures, w: iw, h: ih})}</React.Fragment>)}
              </div>
            );
          })}
        </Glass>
        {props.pedestal ? (
          <>
            <div style={{position: 'absolute', left: fr.x + 30, top: fr.y + fr.h + 6, width: fr.w - 60, height: 16, borderRadius: 8, background: 'linear-gradient(180deg, #ffffff, #cfe9ff)', boxShadow: `0 0 26px ${HALL.cyan}, 0 0 60px rgba(63,200,240,.5)`}} />
            <div style={{position: 'absolute', left: fr.x - 60, top: fr.y + fr.h + 10, width: fr.w + 120, height: 120, borderRadius: '50%', background: 'radial-gradient(ellipse at 50% 30%, rgba(160,225,255,.45), rgba(160,225,255,0) 70%)'}} />
          </>
        ) : null}
        <svg width="1080" height="1920" style={{position: 'absolute', inset: 0}}>
          <defs>
            <radialGradient id="hallHole"><stop offset="0" stopColor="#000" stopOpacity="1" /><stop offset=".55" stopColor="#000" stopOpacity=".85" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
            <mask id="hallSpots">
              <rect width="1080" height="1920" fill="#fff" />
              <ellipse cx={pcx} cy={pcy} rx={fr.w * 0.8} ry={fr.h * 0.66} fill="url(#hallHole)" />
              <ellipse cx={ax} cy={1480} rx={230 * lt.w} ry={470} fill="url(#hallHole)" />
            </mask>
          </defs>
          <rect width="1080" height="1920" fill={lt.tint} opacity={dark * (1 - fl * 0.7)} mask={bo > 0 ? undefined : 'url(#hallSpots)'} />
        </svg>
        <AbsoluteFill style={{mixBlendMode: 'soft-light', background: `radial-gradient(ellipse ${fr.w * 1.1}px ${fr.h * 0.8}px at ${pcx}px ${pcy}px, ${lt.col}, rgba(0,0,0,0) 72%), radial-gradient(ellipse ${220 * lt.w}px 460px at ${ax}px 1470px, ${lt.col}, rgba(0,0,0,0) 72%)`}} />
        <AbsoluteFill style={{mixBlendMode: 'screen', opacity: 0.14 + 0.26 * lt.dark, background: `radial-gradient(ellipse ${fr.w * 1.1}px ${fr.h * 0.8}px at ${pcx}px ${pcy + 200}px, ${curSpill}, rgba(0,0,0,0) 72%)`}} />
        {pictures.map((p, i) => {
          const nb = i < pictures.length - 1 ? pictures[i + 1]!.at : 1e9;
          const o = (i === 0 ? 1 : ease(clamp((t - p.at) / 1))) * (1 - ease(clamp((t - nb - 0.4) / 1.6)));
          if (o <= 0) return null;
          return <div key={'room' + i} style={{position: 'absolute', inset: 0, opacity: o}}>{p.fx.map((n) => <React.Fragment key={n}>{pictureFxInRoom(n, {t, t0: p.at, t1: end, frame: fr, color: p.spill, textures})}</React.Fragment>)}</div>;
        })}
        {shatter.map((s, i) => {
          const k = clamp((t - s.at) / s.dur);
          if (t < s.at || k >= 1) return null;
          const p = pictures[s.picture];
          return p ? <div key={'sh' + i} style={{position: 'absolute', inset: 0}}><Shatter src={p.src} box={{x: fr.x + 10, y: fr.y + 10, w: iw, h: ih}} k={ease(k)} /></div> : null;
        })}
        <WindIn t={t} k={maxOf(t, wind)} />
      </AbsoluteFill>
      {bo > 0 && <AbsoluteFill style={{background: `rgba(0,0,0,${bo})`}} />}
      {bolt && bo > 0 && t >= bolt.at && t < bolt.at + bolt.dur + 0.4 && (() => {
        const k = (t - bolt.at) / bolt.dur;
        const fl2 = k < 0.08 ? 1 : k < 0.16 ? 0.3 : k < 0.3 ? 0.9 : Math.max(0, Math.exp(-(k - 0.3) * 4) * 0.7);
        return (
          <>
            <AbsoluteFill style={{background: `rgba(200,215,255,${fl2 * 0.35})`}} />
            <svg width="1080" height="1920" style={{position: 'absolute', inset: 0}}><LiveBolt t={t} x0={700} y0={-20} x1={420} y1={1150} op={fl2} seed={13} grow={clamp(k * 5)} /></svg>
          </>
        );
      })()}
    </AbsoluteFill>
  );
};

const Props = z.object({
  room: AssetUrl,
  screen: BoxSchema,
  pictures: z.array(z.object({
    src: AssetUrl,
    /** Seconds from the item's start; the first is shown from the start. */
    at: z.number().min(0),
    scale: z.number().positive(),
    origin: z.string().min(1),
    move: z.object({dx: z.number(), dy: z.number(), z: z.number(), r: z.number()}).strict(),
    fx: z.array(z.enum(PICTURE_FX)),
    spill: z.string().min(1),
  }).strict()).min(1),
  camera: CameraSchema,
  flash: FlashSchema,
  /** The hall's light per stanza: how dark, the colour of the spots, how wide the actor's pool. */
  lights: z.array(z.object({at: z.number(), dark: z.number().min(0).max(1), spot: z.string().min(1), w: z.number().positive()}).strict()).min(1),
  blackout: EnvelopeSchema.optional(),
  bolt: z.object({at: z.number(), dur: z.number().positive()}).strict().optional(),
  wind: z.array(EnvelopeSchema).optional(),
  shatter: z.array(z.object({at: z.number(), picture: z.number().int().min(0), dur: z.number().positive()}).strict()).optional(),
  pedestal: z.boolean().optional(),
  /** Where the actor stands, for the pool of light that follows it. */
  actor: z.object({x: z.number(), scale: z.number().positive(), liveFrom: z.number(), liveTo: z.number()}).strict(),
  /** Textures the fog, wind and water effects draw with. */
  textures: z.object({fog: AssetUrl.optional(), caustics: AssetUrl.optional()}).strict().optional(),
}).strict();

const sample = (extra: Record<string, unknown> = {}) => ({
  room: {$asset: 'room'},
  screen: {x: 360, y: 215, w: 620, h: 910},
  pictures: [
    {src: {$asset: 'pic-a'}, at: 0, scale: 1.07, origin: '50% 40%', move: {dx: -10, dy: -14, z: 0.15, r: -0.16}, fx: ['nebbia'], spill: '#b9a8ff'},
    {src: {$asset: 'pic-b'}, at: 4, scale: 1.07, origin: '50% 40%', move: {dx: 14, dy: -8, z: 0.16, r: 0.14}, fx: ['vento', 'acqua'], spill: '#8fd3ff'},
  ],
  camera: {origin: [600, 1100], zoom: [{from: 0.5, to: 9, rampIn: 6, rampOut: 1.4, amount: 0.025}], shake: []},
  flash: {strikes: [3.95]},
  lights: [{at: 0, dark: 0.05, spot: '#eaf4ff', w: 1}],
  pedestal: true,
  actor: {x: 770, scale: 0.95, liveFrom: 0, liveTo: 0.8},
  textures: {fog: {$asset: 'fog'}, caustics: {$asset: 'caustics'}},
  ...extra,
});
const samples = {room: 'hall.png', 'pic-a': 'picture-a.png', 'pic-b': 'picture-b.png', fog: 'fog.png', caustics: 'caustics.png'};

export const kit: KitVersion = {
  name: 'museum-hall',
  version: '1.0.0',
  description: "A museum hall in a 9:16 frame: room, glass screen with the pictures and their slow camera, their effects inside and out, lightning, lights and dark, pedestal, wind, shatter and blackout, all under one shared camera.",
  profiles: ['vertical-1080x1920'],
  props: Props,
  component: MuseumHall,
  examples: [
    {id: 'first-picture', props: sample(), samples, durationInFrames: 300, frame: 60},
    {id: 'lightning', props: sample(), samples, durationInFrames: 300, frame: 120},
    {id: 'second-picture', props: sample({wind: [{from: 5, to: 9, rampIn: 0.6, rampOut: 0.8, amount: 0.75}]}), samples, durationInFrames: 300, frame: 210},
    {id: 'shatter', props: sample({shatter: [{at: 6, picture: 1, dur: 1.5}]}), samples, durationInFrames: 300, frame: 195},
    {id: 'blackout', props: sample({blackout: {from: 5, to: 9.5, rampIn: 0.5, rampOut: 0.8, amount: 1}, bolt: {at: 5.7, dur: 0.75}}), samples, durationInFrames: 300, frame: 173},
  ],
};
