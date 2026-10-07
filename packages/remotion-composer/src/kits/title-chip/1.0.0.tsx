// title-chip@1.0.0 — released: never edit this file; add title-chip/<next>.tsx instead.
// A compact title · author chip at the top right while the poem is recited
// (Dentro i versi, from CreativeStudio's sala8). Long titles drop the author.
import React from 'react';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {ANTON, SANS, useFonts} from '../lib/fonts/1.0.0.js';
import {TITLES} from '../lib/dentro-i-versi/1.0.0.js';

const TitleChip: KitVersion['component'] = ({props}) => {
  useFonts();
  const author = props.author as string | undefined;
  return (
    <div style={{position: 'absolute', right: (props.right as number | undefined) ?? 140, top: (props.y as number | undefined) ?? 120, display: 'inline-flex', alignItems: 'baseline', gap: 14, padding: '10px 22px 12px', borderRadius: 12, background: TITLES.chip, border: '1px solid rgba(255,255,255,.45)', boxShadow: `inset 0 2px 0 ${TITLES.cyan}`}}>
      <span style={{fontFamily: ANTON, fontSize: 36, letterSpacing: 2, color: TITLES.text, textTransform: 'uppercase', whiteSpace: 'nowrap'}}>{props.title as string}</span>
      {author ? <span style={{fontFamily: SANS, fontWeight: 600, fontSize: 18, letterSpacing: 4, color: TITLES.cyan, whiteSpace: 'nowrap'}}>{author.toUpperCase()}</span> : null}
    </div>
  );
};

export const kit: KitVersion = {
  name: 'title-chip',
  version: '1.0.0',
  description: 'A compact title · author chip at the top right of a 9:16 frame; without an author for a long title.',
  layer: 'overlay',
  profiles: ['vertical-1080x1920'],
  props: z.object({
    title: z.string().min(1).max(40),
    author: z.string().min(1).optional(),
    /** Distance of the chip's right edge from the frame's. */
    right: z.number().min(0).optional(),
    y: z.number().min(0).optional(),
  }).strict(),
  component: TitleChip,
  examples: [
    {id: 'with-author', props: {title: 'San Martino', author: 'Giosuè Carducci'}, durationInFrames: 30, frame: 0},
    {id: 'long-title', props: {title: 'Frate Sole e Sora Luna'}, durationInFrames: 30, frame: 0},
  ],
};
