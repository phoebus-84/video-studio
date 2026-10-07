// brand-mark@2.0.0 — released: never edit this file; add brand-mark/<next>.tsx instead.
// A channel's mark on a glass pill, top left of a 16:9 frame: its text and
// icon from the channel theme's brand, its colours and font from the look
// (ADR-0040). 2.0.0: channel-neutral, the look and the text are props.
import React from 'react';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';

const BrandMark: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  return (
    <div style={{position: 'absolute', left: (props.x as number | undefined) ?? 110, top: (props.y as number | undefined) ?? 60, display: 'flex', alignItems: 'center', gap: 12, padding: '9px 18px 9px 14px', borderRadius: 999, background: alpha(look.colors.plate, 0.72), border: `1px solid ${look.colors.plateLine}`}}>
      {props.icon === 'bolt' ? <svg width="18" height="26" viewBox="0 0 18 26"><path d="M11 0 L1 15 H8 L6 26 L17 10 H10 Z" fill={look.colors.highlight} /></svg> : null}
      <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 22, letterSpacing: 6, color: look.colors.text, whiteSpace: 'nowrap'}}>{props.text as string}</div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'brand-mark',
  version: '2.0.0',
  description: "A channel's mark — its icon and name on a glass pill — top left of a 16:9 frame, in the channel theme's look.",
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    text: z.string().min(1).max(40),
    icon: z.enum(['bolt', 'none']),
    x: z.number().min(0).optional(),
    y: z.number().min(0).optional(),
  }).strict(),
  component: BrandMark,
  examples: [
    {id: 'bolt', props: {look: DEMO_LOOK, text: 'DEMO CHANNEL', icon: 'bolt'}, durationInFrames: 30, frame: 0},
    {id: 'text-only', props: {look: DEMO_LOOK, text: 'DEMO', icon: 'none'}, durationInFrames: 30, frame: 0},
  ],
};
