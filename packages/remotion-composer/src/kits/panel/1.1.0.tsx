// panel@1.1.0 — released: never edit this file; add panel/<next>.tsx instead.
// The glass panel of a 16:9 lesson and what it shows, phase by phase, as a
// stack of layers (from CreativeStudio's poesie-museo-long story scenes): a
// picture framed on its focus with a slow push, pictures side by side, a
// clip, a grid of light, a darkening, a portrait beside a dark grid, a framed
// picture over the others; each may be shaded and dimmed. Between phases the
// glass turns on itself and the content changes halfway through the turn; it
// materialises with a scan line, its edge lights up with a flash, and a
// discreet credit sits in its corner. Texts are other items: the compiler
// hides them during a turn. Channel-neutral: the look is a prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {clamp, ease, ramp} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LoopClip, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';

type Focus = [number, number];
type Shade = 'left' | 'left-strong' | 'quote' | 'storm' | number;
interface Common {shade?: Shade; dim?: {at: number; amount: number}}
type Layer = Common & (
  | {picture: {src: string; focus?: Focus; zoom?: number; push?: number}}
  | {split: {items: {src: string; focus?: Focus; at?: number; label?: string}[]; gap?: number; sign?: string}}
  | {clip: {src: string; live?: [number, number]; push?: number}}
  | {grid: {at?: Focus}}
  | {dark: {amount: number}}
  | {portrait: {src: string; width?: number; focusY?: number; dark?: number}}
  | {framed: {src: string; box?: Box; at?: number; focus?: Focus; push?: number}});
interface Phase {at: number; layers: Layer[]; tag?: string}

/** A turn of the glass takes this long; the content changes halfway. */
const SPIN = 1.0;

const Panel: KitVersion['component'] = ({props, context}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const end = durationInFrames / fps;
  const box = (props.box as Box | undefined) ?? {x: 440, y: 150, w: 1060, h: 596};
  const phases = props.phases as Phase[];
  const spins = (props.spin ?? true) ? phases.slice(1).map((p) => p.at) : [];
  const shownAt = (i: number) => phases[i]!.at + (i > 0 && spins.length ? SPIN / 2 : 0);
  const ci = phases.reduce((cur, _p, i) => (t >= shownAt(i) ? i : cur), 0);
  const since = t - shownAt(ci);
  const life = Math.max(0.5, (ci + 1 < phases.length ? shownAt(ci + 1) : end) - shownAt(ci));
  const spin = spins.reduce((s, a) => s + 360 * ease((t - a) / SPIN), 0);
  const on = props.appear ? clamp((t - (props.appear as {at: number}).at) / (props.appear as {dur: number}).dur) : 1;
  const fl = strikeAt(t, ((props.flash as {strikes: number[]} | undefined) ?? {strikes: []}).strikes);
  const inner: Box = {x: 0, y: 0, w: box.w - 20, h: box.h - 20};
  const pushed = (zoom: number | undefined, push: number | undefined, from = 0) => (zoom ?? 1.04) + (push ?? 0.06) * ease((since - from) / life);
  const deep = c.backdrop;
  const shades: Record<string, string> = {
    left: `linear-gradient(90deg, ${alpha(deep, 0.78)}, ${alpha(deep, 0.1)} 62%)`,
    'left-strong': `linear-gradient(90deg, ${alpha(deep, 0.88)}, ${alpha(deep, 0.35)} 62%, ${alpha(deep, 0.08)})`,
    quote: `linear-gradient(90deg, ${alpha(deep, 0.86)}, ${alpha(deep, 0.35)} 70%, ${alpha(deep, 0.15)})`,
    storm: `linear-gradient(90deg, ${alpha(deep, 0.85)}, ${alpha(deep, 0.25)} 70%)`,
  };
  const grid: React.CSSProperties = {position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${alpha(c.accent, 0.07)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(c.accent, 0.07)} 1px, transparent 1px)`, backgroundSize: '48px 48px'};
  const chip = (text: string, x: number, y: number, width: number) => (
    <div style={{position: 'absolute', left: x, top: y, transform: 'translateY(-100%)', padding: '8px 16px 9px', borderRadius: 10, background: alpha(c.plate, 1), border: `1px solid ${c.plateLine}`, boxShadow: `inset 0 2px 0 ${c.accent}`, fontFamily: fonts.sans, fontWeight: 600, fontSize: fitSize({family: look.fonts.sans, weight: 600}, [text], width - 44 - 34, 26, () => 2), letterSpacing: 2, color: c.text, whiteSpace: 'nowrap'}}>{text}</div>
  );
  const at = (x: number | undefined) => (x === undefined ? 1 : ramp(t, x - 0.2, x + 0.2));

  const body = (L: Layer): React.ReactNode => {
    if ('picture' in L) {
      const [cx, cy] = L.picture.focus ?? [0.5, 0.5];
      return <Cover src={L.picture.src} box={inner} cx={cx} cy={cy} zoom={pushed(L.picture.zoom, L.picture.push)} />;
    }
    if ('split' in L) {
      const n = L.split.items.length;
      const gap = L.split.gap ?? 16;
      const w = (inner.w - gap * (n - 1)) / n;
      return (
        <>
          {L.split.items.map((it, j) => {
            const [cx, cy] = it.focus ?? [0.5, 0.5];
            return (
              <div key={j} style={{position: 'absolute', left: j * (w + gap), top: 0, width: w, height: inner.h, overflow: 'hidden', opacity: at(it.at)}}>
                <Cover src={it.src} box={{x: 0, y: 0, w, h: inner.h}} cx={cx} cy={cy} zoom={pushed(undefined, undefined)} />
                {it.label ? chip(it.label, 22, inner.h - 22, w) : null}
              </div>
            );
          })}
          {L.split.sign ? (
            <div style={{position: 'absolute', left: inner.w / 2 - 50, top: inner.h / 2 - 50, width: 100, height: 100, borderRadius: 50, background: alpha(c.plate, 1), border: `2px solid ${c.plateLine}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.sans, fontWeight: 600, fontSize: 40, color: c.text}}>{L.split.sign}</div>
          ) : null}
        </>
      );
    }
    if ('clip' in L) {
      const [a, b] = L.clip.live ?? [-1, end + 1];
      const live = clamp((t - a) / 0.5) * clamp((b - t) / 0.5);
      return <div style={{position: 'absolute', inset: 0, transform: `scale(${pushed(1, L.clip.push ?? 0)})`}}><LoopClip src={L.clip.src} box={inner} live={live} frames={context.assetFrames[L.clip.src]} /></div>;
    }
    if ('grid' in L) {
      const [gx, gy] = L.grid.at ?? [0.5, 0.45];
      return <div style={{position: 'absolute', inset: 0, background: `radial-gradient(900px 500px at ${gx * 100}% ${gy * 100}%, ${alpha(c.accent, 0.22)}, ${deep})`}}><div style={grid} /></div>;
    }
    if ('dark' in L) return <div style={{position: 'absolute', inset: 0, background: alpha(deep, L.dark.amount)}} />;
    if ('portrait' in L) {
      const w = L.portrait.width ?? 420;
      return (
        <>
          <Cover src={L.portrait.src} box={{x: 0, y: 0, w, h: inner.h}} cy={L.portrait.focusY ?? 0.25} zoom={pushed(1, 0.05)} />
          <div style={{position: 'absolute', left: w, top: 0, right: 0, bottom: 0, background: alpha(deep, L.portrait.dark ?? 0.62)}}><div style={grid} /></div>
        </>
      );
    }
    const f = L.framed;
    const bx = f.box ?? {x: inner.w - 400, y: 30, w: 350, h: inner.h - 60};
    const [cx, cy] = f.focus ?? [0.5, 0.4];
    return (
      <div style={{position: 'absolute', left: bx.x, top: bx.y, width: bx.w, height: bx.h, opacity: f.at === undefined ? 1 : ramp(t, f.at - 0.3, f.at + 0.2), border: `2px solid ${alpha(c.text, 0.85)}`, borderRadius: 10, overflow: 'hidden', boxShadow: `0 20px 50px ${c.shadow}`}}>
        <Cover src={f.src} box={{x: 0, y: 0, w: bx.w, h: bx.h}} cx={cx} cy={cy} zoom={pushed(1.02, f.push, f.at === undefined ? 0 : f.at - shownAt(ci))} />
      </div>
    );
  };
  const layer = (L: Layer, key: number) => {
    const dim = L.dim ? 1 - L.dim.amount * ramp(t, L.dim.at, L.dim.at + 0.3) : 1;
    const shade = L.shade === undefined ? null : <div style={{position: 'absolute', inset: 0, background: typeof L.shade === 'number' ? alpha(deep, L.shade) : shades[L.shade]}} />;
    return <div key={key} style={{position: 'absolute', inset: 0, filter: dim < 1 ? `brightness(${dim})` : undefined}}>{body(L)}{shade}</div>;
  };
  const current = phases[ci]!;
  const turning = spins.some((a) => t >= a && t < a + SPIN);
  const camera = props.camera as Camera | undefined;
  return (
    <AbsoluteFill style={camera ? cameraStyle(t, camera) : undefined}>
      <Glass look={look} box={box} t={t} on={on} spin={spin} flash={fl}>
        <div style={{position: 'absolute', inset: 0}}>{current.layers.map(layer)}</div>
        {current.tag && !turning ? (
          <div style={{position: 'absolute', right: 14, bottom: 12, opacity: 0.72, fontFamily: fonts.sans, fontWeight: 600, fontSize: 18, letterSpacing: 3, color: '#fff', textShadow: look.measures.textShadow}}>{current.tag}</div>
        ) : null}
      </Glass>
    </AbsoluteFill>
  );
};

const Focus = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const Zoom = z.number().min(1).max(3);
const Push = z.number().min(0).max(1);
const Common = {
  shade: z.union([z.enum(['left', 'left-strong', 'quote', 'storm']), z.number().min(0).max(1)]).optional(),
  dim: z.object({at: z.number(), amount: z.number().min(0).max(1)}).strict().optional(),
};
const LayerSchema = z.union([
  z.object({picture: z.object({src: AssetUrl, focus: Focus.optional(), zoom: Zoom.optional(), push: Push.optional()}).strict(), ...Common}).strict(),
  z.object({split: z.object({items: z.array(z.object({src: AssetUrl, focus: Focus.optional(), at: z.number().optional(), label: z.string().min(1).max(30).optional()}).strict()).min(2).max(4), gap: z.number().min(0).max(80).optional(), sign: z.string().min(1).max(3).optional()}).strict(), ...Common}).strict(),
  z.object({clip: z.object({src: AssetUrl, live: z.tuple([z.number(), z.number()]).optional(), push: Push.optional()}).strict(), ...Common}).strict(),
  z.object({grid: z.object({at: Focus.optional()}).strict(), ...Common}).strict(),
  z.object({dark: z.object({amount: z.number().min(0).max(1)}).strict(), ...Common}).strict(),
  z.object({portrait: z.object({src: AssetUrl, width: z.number().positive().max(1000).optional(), focusY: z.number().min(0).max(1).optional(), dark: z.number().min(0).max(1).optional()}).strict(), ...Common}).strict(),
  z.object({framed: z.object({src: AssetUrl, box: BoxSchema.optional(), at: z.number().optional(), focus: Focus.optional(), push: Push.optional()}).strict(), ...Common}).strict(),
]);

const P = (extra: Record<string, unknown>) => ({look: DEMO_LOOK, ...extra});
const A = {$asset: 'a'};
const B = {$asset: 'b'};
const SAMPLES = {a: 'picture-a.png', b: 'picture-b.png'};

export const kit: KitVersion = {
  name: 'panel',
  version: '1.1.0',
  description: "The glass panel of a 16:9 lesson and what it shows phase by phase, as stacked layers — a picture, pictures side by side, a clip, a grid of light, a darkening, a portrait, a framed picture, shaded or dimmed — turning between phases, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    /** What the glass shows from each instant (seconds from the item's start), bottom layer first; the first phase from the start. */
    phases: z.array(z.object({at: z.number().min(0), layers: z.array(LayerSchema).min(1).max(6), tag: z.string().min(1).max(30).optional()}).strict()).min(1)
      .refine((ps) => ps.every((p, i) => i === 0 || p.at > ps[i - 1]!.at), {message: 'phases come one after the other, each at a later instant'}),
    /** The glass turns at each phase change unless false. */
    spin: z.boolean().optional(),
    /** It materialises over [at, at + dur] instead of being there. */
    appear: z.object({at: z.number().min(0), dur: z.number().positive()}).strict().optional(),
    flash: z.object({strikes: z.array(z.number())}).strict().optional(),
    camera: CameraSchema.optional(),
  }).strict(),
  component: Panel,
  examples: [
    {id: 'shaded', props: P({phases: [{at: 0, layers: [{picture: {src: A, focus: [0.5, 0.6]}, shade: 'left-strong'}], tag: 'AI RECONSTRUCTION'}]}), samples: SAMPLES, durationInFrames: 90, frame: 60},
    {id: 'split-three', props: P({phases: [{at: 0, layers: [{split: {items: [{src: A, label: 'THE FATHER'}, {src: B, at: 0.4, label: 'THE MOTHER'}, {src: A, at: 0.8, label: 'MARGHERITA'}]}}]}]}), samples: SAMPLES, durationInFrames: 60, frame: 45},
    {id: 'grid-portrait', props: P({phases: [{at: 0, layers: [{grid: {}}, {portrait: {src: B}}]}]}), samples: SAMPLES, durationInFrames: 60, frame: 30},
    {id: 'framed-dimmed', props: P({phases: [{at: 0, layers: [{picture: {src: A}, dim: {at: 0.2, amount: 0.5}}, {framed: {src: B, at: 0.3}}]}]}), samples: SAMPLES, durationInFrames: 60, frame: 45},
    {id: 'turning', props: P({phases: [{at: 0, layers: [{picture: {src: A}}]}, {at: 1, layers: [{clip: {src: {$asset: 'clip'}}, shade: 0.3}]}]}), samples: {...SAMPLES, clip: 'clip.mp4'}, durationInFrames: 90, frame: 40},
  ],
};
