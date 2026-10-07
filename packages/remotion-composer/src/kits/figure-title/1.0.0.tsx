// figure-title@1.0.0 — released: never edit this file; add figure-title/<next>.tsx instead.
// The name of a rhetorical figure or a keyword: a kicker and the name in the
// display font on a dark plate, sized to the width it has, settling in
// (from CreativeStudio's poesie-museo-long FigureTitle). Channel-neutral.
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {ease} from '../lib/stage-math/1.0.0.js';

const FigureTitle: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const t = useCurrentFrame() / useVideoConfig().fps;
  const k = ease(t / 0.6);
  const w = (props.maxWidth as number | undefined) ?? 820;
  const text = props.text as string;
  const size = Math.min((props.size as number | undefined) ?? 96, (w - 80) / (text.length * 0.5));
  const center = (props.align ?? 'center') === 'center';
  const x = props.x as number;
  return (
    <div style={{position: 'absolute', left: center ? x - w / 2 : x, top: props.y as number, width: w, display: 'flex', justifyContent: center ? 'center' : 'flex-start'}}>
      <div style={{display: 'inline-flex', flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', gap: 10, padding: '18px 34px 22px', ...plateStyle(look), transform: `scale(${0.94 + 0.06 * k})`}}>
        <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 26, letterSpacing: 7, color: look.colors.accent}}>{props.kicker as string}</div>
        <div style={{fontFamily: fonts.display, fontSize: size, letterSpacing: (1 - k) * 12 + 3, color: look.colors.text, lineHeight: 1, whiteSpace: 'nowrap'}}>{text}</div>
      </div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'figure-title',
  version: '1.0.0',
  description: 'The name of a rhetorical figure or keyword — a kicker and the name in the display font on a dark plate, fitted to its width — in a 16:9 frame, in the channel theme\'s look.',
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    kicker: z.string().min(1).max(40),
    text: z.string().min(1).max(40),
    /** Centre (align center) or left edge (align left) of the plate's box. */
    x: z.number(),
    y: z.number(),
    maxWidth: z.number().positive().optional(),
    size: z.number().positive().max(160).optional(),
    align: z.enum(['center', 'left']).optional(),
  }).strict(),
  component: FigureTitle,
  examples: [
    {id: 'figure', props: {look: DEMO_LOOK, kicker: 'RHETORICAL FIGURE', text: 'ONOMATOPOEIA', x: 960, y: 220}, durationInFrames: 45, frame: 30},
    {id: 'settling', props: {look: DEMO_LOOK, kicker: 'KEYWORD', text: 'LIGHT', x: 960, y: 220}, durationInFrames: 45, frame: 6},
  ],
};
