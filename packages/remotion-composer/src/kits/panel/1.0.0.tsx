// panel@1.0.0 — released: never edit this file; add panel/<next>.tsx instead.
// The glass panel of a 16:9 lesson and what it shows, phase by phase: one
// picture framed on its focus with a slow push, two pictures side by side
// with their labels, or a clip. Between phases the glass turns on itself and
// the content changes halfway through the turn; it materialises with a scan
// line, its edge lights up with a flash, and a discreet credit sits in its
// corner when the picture is a reconstruction (from CreativeStudio's
// poesie-museo-long Glass, Cover, LoopClip, AiTag). Channel-neutral.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {clamp, ease} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LoopClip, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';

interface Framed {src: string; focus?: [number, number]; zoom?: number; zoomTo?: number; label?: string}
type Content =
  | ({kind: 'picture'} & Framed)
  | {kind: 'pair'; left: Framed; right: Framed; sign?: string}
  | {kind: 'clip'; src: string; live?: [number, number]};
interface Phase {at: number; content: Content; tag?: string}

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
  const phases = [...(props.phases as Phase[])].sort((a, b) => a.at - b.at);
  const spins = (props.spin ?? true) ? phases.slice(1).map((p) => p.at) : [];
  // the phase on the glass: a new one shows from halfway through its turn
  const current = phases.reduce((cur, p, i) => (i === 0 || t >= p.at + (spins.length ? SPIN / 2 : 0) ? p : cur), phases[0]!);
  const spin = spins.reduce((s, a) => s + 360 * ease((t - a) / SPIN), 0);
  const on = props.appear ? clamp((t - (props.appear as {at: number}).at) / (props.appear as {dur: number}).dur) : 1;
  const fl = strikeAt(t, ((props.flash as {strikes: number[]} | undefined) ?? {strikes: []}).strikes);
  const inner = {x: 0, y: 0, w: box.w - 20, h: box.h - 20};
  // a phase is on the glass from halfway through its turn (from its instant without turns): its push starts then
  const shownAt = (i: number) => phases[i]!.at + (i > 0 && spins.length ? SPIN / 2 : 0);
  const ci = phases.indexOf(current);
  const since = t - shownAt(ci);
  const life = Math.max(0.5, (ci + 1 < phases.length ? shownAt(ci + 1) : end) - shownAt(ci));

  const framed = (f: Framed, b: Box) => {
    const z0 = f.zoom ?? 1.04;
    const z1 = f.zoomTo ?? z0 + 0.06;
    const [cx, cy] = f.focus ?? [0.5, 0.5];
    return <Cover src={f.src} box={b} cx={cx} cy={cy} zoom={z0 + (z1 - z0) * ease(since / life)} />;
  };
  // a label fits the picture it names: sized down until it ends 22 px inside it
  const chip = (text: string, x: number, y: number, width: number) => (
    <div style={{position: 'absolute', left: x, top: y, transform: 'translateY(-100%)', padding: '8px 16px 9px', borderRadius: 10, background: alpha(c.plate, 1), border: `1px solid ${c.plateLine}`, boxShadow: `inset 0 2px 0 ${c.accent}`, fontFamily: fonts.sans, fontWeight: 600, fontSize: fitSize({family: look.fonts.sans, weight: 600}, [text], width - 44 - 34, 26, () => 2), letterSpacing: 2, color: c.text, whiteSpace: 'nowrap'}}>{text}</div>
  );
  const content = current.content;
  let body: React.ReactNode;
  if (content.kind === 'picture') {
    body = <>{framed(content, inner)}{content.label ? chip(content.label, 22, inner.h - 22, inner.w) : null}</>;
  } else if (content.kind === 'pair') {
    const half = (inner.w - 8) / 2;
    body = (
      <>
        {framed(content.left, {x: 0, y: 0, w: half, h: inner.h})}
        {framed(content.right, {x: half + 8, y: 0, w: half, h: inner.h})}
        {content.left.label ? chip(content.left.label, 22, inner.h - 22, half) : null}
        {content.right.label ? chip(content.right.label, half + 30, inner.h - 22, half) : null}
        {content.sign ? (
          <div style={{position: 'absolute', left: inner.w / 2 - 50, top: inner.h / 2 - 50, width: 100, height: 100, borderRadius: 50, background: alpha(c.plate, 1), border: `2px solid ${c.plateLine}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.sans, fontWeight: 600, fontSize: 40, color: c.text}}>{content.sign}</div>
        ) : null}
      </>
    );
  } else {
    const [a, b] = content.live ?? [-1, end + 1];
    const live = clamp((t - a) / 0.5) * clamp((b - t) / 0.5);
    body = <LoopClip src={content.src} box={inner} live={live} frames={context.assetFrames[content.src]} />;
  }
  // texts hide while the glass turns
  const turning = spins.some((a) => t >= a && t < a + SPIN);
  const camera = props.camera as Camera | undefined;
  return (
    <AbsoluteFill style={camera ? cameraStyle(t, camera) : undefined}>
      <Glass look={look} box={box} t={t} on={on} spin={spin} flash={fl}>
        <div style={{position: 'absolute', inset: 0}}>{body}</div>
        {current.tag && !turning ? (
          <div style={{position: 'absolute', right: 14, bottom: 12, opacity: 0.72, fontFamily: fonts.sans, fontWeight: 600, fontSize: 18, letterSpacing: 3, color: '#fff', textShadow: look.measures.textShadow}}>{current.tag}</div>
        ) : null}
      </Glass>
    </AbsoluteFill>
  );
};

const Framed = z.object({
  src: AssetUrl,
  /** The point of the picture (0–1) the frame keeps in view. */
  focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  /** Zoom at the phase's start and end (a slow push). */
  zoom: z.number().min(1).max(3).optional(),
  zoomTo: z.number().min(1).max(3).optional(),
  label: z.string().min(1).max(30).optional(),
}).strict();
const Content = z.discriminatedUnion('kind', [
  Framed.extend({kind: z.literal('picture')}).strict(),
  z.object({kind: z.literal('pair'), left: Framed, right: Framed, sign: z.string().min(1).max(3).optional()}).strict(),
  z.object({kind: z.literal('clip'), src: AssetUrl, live: z.tuple([z.number(), z.number()]).optional()}).strict(),
]);

const P = (extra: Record<string, unknown>) => ({look: DEMO_LOOK, ...extra});
const SAMPLES = {a: 'picture-a.png', b: 'picture-b.png'};

export const kit: KitVersion = {
  name: 'panel',
  version: '1.0.0',
  description: 'The glass panel of a 16:9 lesson and what it shows phase by phase — a picture framed on its focus, two pictures with labels, or a clip — turning between phases, in the channel theme\'s look.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    /** What the glass shows from each instant (seconds from the item's start); the first from the start. */
    phases: z.array(z.object({at: z.number().min(0), content: Content, tag: z.string().min(1).max(30).optional()}).strict()).min(1)
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
    {id: 'picture', props: P({phases: [{at: 0, content: {kind: 'picture', src: {$asset: 'a'}, focus: [0.5, 0.6]}, tag: 'AI RECONSTRUCTION'}]}), samples: SAMPLES, durationInFrames: 90, frame: 60},
    {id: 'pair', props: P({phases: [{at: 0, content: {kind: 'pair', left: {src: {$asset: 'a'}, label: 'THE WHITE HOUSE'}, right: {src: {$asset: 'b'}, label: 'THE LOST NEST'}, sign: '=?'}}]}), samples: SAMPLES, durationInFrames: 90, frame: 60},
    {id: 'long-labels', props: P({phases: [{at: 0, content: {kind: 'pair', left: {src: {$asset: 'a'}, label: 'A LABEL OF THIRTY CHARACTERS!'}, right: {src: {$asset: 'b'}, label: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM'}}}]}), samples: SAMPLES, durationInFrames: 90, frame: 60},
    {id: 'turning', props: P({phases: [{at: 0, content: {kind: 'picture', src: {$asset: 'a'}}}, {at: 1, content: {kind: 'picture', src: {$asset: 'b'}}}]}), samples: SAMPLES, durationInFrames: 90, frame: 40},
    {id: 'appearing', props: P({appear: {at: 0, dur: 1.2}, phases: [{at: 0, content: {kind: 'picture', src: {$asset: 'b'}}}]}), samples: SAMPLES, durationInFrames: 90, frame: 18},
    {id: 'clip', props: P({phases: [{at: 0, content: {kind: 'clip', src: {$asset: 'clip'}}}]}), samples: {clip: 'clip.mp4'}, durationInFrames: 60, frame: 30},
  ],
};
