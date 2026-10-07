// brand-mark@1.0.0 — released: never edit this file; add brand-mark/<next>.tsx instead.
// The programme's mark: a lightning bolt and its name on a dark glass pill,
// top left (Dentro i versi's titles, from CreativeStudio's sala8).
import React from 'react';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {SANS, useFonts} from '../lib/fonts/1.0.0.js';
import {TITLES} from '../lib/dentro-i-versi/1.0.0.js';

const BrandMark: KitVersion['component'] = ({props}) => {
  useFonts();
  const x = (props.x as number | undefined) ?? 60;
  const y = (props.y as number | undefined) ?? 120;
  return (
    <div style={{position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px 10px 16px', borderRadius: 999, background: TITLES.pill, border: '1px solid rgba(255,255,255,.38)'}}>
      <svg width="20" height="28" viewBox="0 0 18 26"><path d="M11 0 L1 15 H8 L6 26 L17 10 H10 Z" fill={TITLES.amber} /></svg>
      <div style={{fontFamily: SANS, fontWeight: 600, fontSize: 24, letterSpacing: 6, color: TITLES.text, whiteSpace: 'nowrap'}}>{(props.text as string | undefined) ?? 'DENTRO I VERSI'}</div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'brand-mark',
  version: '1.0.0',
  description: "The programme's mark — a lightning bolt and its name on a dark glass pill — at the top left of a 9:16 frame.",
  layer: 'overlay',
  profiles: ['vertical-1080x1920'],
  props: z.object({
    text: z.string().min(1).max(40).optional(),
    x: z.number().min(0).optional(),
    y: z.number().min(0).optional(),
  }).strict(),
  component: BrandMark,
  examples: [
    {id: 'default', props: {}, durationInFrames: 30, frame: 0},
    {id: 'renamed', props: {text: 'POESIE'}, durationInFrames: 30, frame: 0},
  ],
};
