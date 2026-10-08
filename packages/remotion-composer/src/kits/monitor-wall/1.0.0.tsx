// monitor-wall@1.0.0 — released: never edit this file; add monitor-wall/<next>.tsx instead.
// The invitation to listen again (from CreativeStudio's poesie-museo-long card):
// a wall of glass monitors — the lesson's pictures and a clip — appearing one
// after the other in a grid that adapts to how many there are, and a caption on
// a full plate under them, never over them. Channel-neutral: the look is a
// prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, plateStyle, type ColorRole, type Look} from '../lib/look/1.0.0.js';
import {TEXT_ROLES} from '../lib/lesson-tools/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ramp} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LoopClip, type Box} from '../lib/lesson-stage/1.0.0.js';

interface Cell {src: string; focus?: [number, number]; kind?: 'picture' | 'clip'}

const MonitorWall: KitVersion['component'] = ({props, context}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const t = useCurrentFrame() / useVideoConfig().fps;
  const G = (props.box as Box | undefined) ?? {x: 480, y: 140, w: 980, h: 560};
  const cells = props.cells as Cell[];
  const appear = (props.appear as number | undefined) ?? 0;
  const caption = (props.caption as {text: string; at: number; color?: ColorRole}[] | undefined) ?? [];
  // 2 columns up to 4 cells, 3 up to 6, 4 beyond
  const NC = cells.length <= 4 ? 2 : cells.length <= 6 ? 3 : 4;
  const NR = Math.ceil(cells.length / NC);
  const gw = (G.w - 20 * (NC - 1)) / NC;
  const gh = (G.h - 24 * (NR - 1)) / NR;
  const capSize = caption.length ? fitSize({family: look.fonts.display, weight: 400}, [caption.map((x) => x.text).join('   ')], 1680 - 88, 76, () => 2) : 76;
  return (
    <AbsoluteFill>
      {cells.map((cell, i) => {
        const bx: Box = {x: G.x + (i % NC) * (gw + 20), y: G.y + Math.floor(i / NC) * (gh + 24), w: gw, h: gh};
        const inner: Box = {x: 0, y: 0, w: gw - 20, h: gh - 20};
        const [cx, cy] = cell.focus ?? [0.5, 0.5];
        return (
          <Glass key={i} look={look} box={bx} t={t} on={ramp(t, appear - 0.3 + i * 0.12, appear + 0.2 + i * 0.12)} tilt={0}>
            {cell.kind === 'clip' ? <LoopClip src={cell.src} box={inner} live={1} frames={context.assetFrames[cell.src]} /> : <Cover src={cell.src} box={inner} cx={cx} cy={cy} />}
          </Glass>
        );
      })}
      {caption.length ? (
        <div style={{position: 'absolute', left: 0, right: 0, top: G.y + G.h + 40, display: 'flex', justifyContent: 'center'}}>
          <div style={{display: 'flex', gap: 34, alignItems: 'baseline', padding: '18px 44px 22px', ...plateStyle(look), opacity: ramp(t, caption[0]!.at - 0.3, caption[0]!.at + 0.1)}}>
            {caption.map((x, i) => <div key={i} style={{fontFamily: fonts.display, fontSize: capSize, letterSpacing: 2, color: look.colors[x.color ?? 'text'], opacity: ramp(t, x.at, x.at + 0.3), whiteSpace: 'nowrap'}}>{x.text}</div>)}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const SIX = Array.from({length: 6}, (_, i) => ({src: {$asset: i % 2 ? 'b' : 'a'}}));

export const kit: KitVersion = {
  name: 'monitor-wall',
  version: '1.0.0',
  description: "A wall of glass monitors in a 16:9 frame — a lesson's pictures and a clip, appearing one after another in a grid that adapts — with a caption on a plate under them, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** The grid's box (default 480/140/980×560); the caption sits 40 px under it. */
    box: BoxSchema.optional(),
    cells: z.array(z.object({src: AssetUrl, focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(), kind: z.enum(['picture', 'clip']).optional()}).strict()).min(1).max(8),
    /** The monitors appear one after the other from here. */
    appear: z.number().optional(),
    caption: z.array(z.object({text: z.string().min(1).max(30), at: z.number(), color: z.enum(TEXT_ROLES).optional()}).strict()).max(3).optional(),
  }).strict(),
  component: MonitorWall,
  examples: [
    {id: 'six', props: {look: DEMO_LOOK, cells: SIX, caption: [{text: 'SAME WORDS.', at: 1}, {text: 'ANOTHER LOOK.', at: 1.6, color: 'highlight'}]}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 90, frame: 75},
    {id: 'four-with-clip', props: {look: DEMO_LOOK, cells: [...SIX.slice(0, 3), {src: {$asset: 'clip'}, kind: 'clip'}]}, samples: {a: 'picture-a.png', b: 'picture-b.png', clip: 'clip.mp4'}, durationInFrames: 60, frame: 45},
    {id: 'appearing', props: {look: DEMO_LOOK, cells: SIX, appear: 0.3}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 60, frame: 18},
  ],
};
