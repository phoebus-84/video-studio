// lower-third@1.0.0 — released: never edit this file; add lower-third/<next>.tsx instead.
// The poem's card at the opening and at the bow: the eyebrow (author ·
// collection) in cyan, the title in Anton on its lines, a cyan rule that
// grows, the author. Bottom-anchored, so a longer card grows upwards; its
// shadow is kept short so every pixel stays in the safe zone. From
// CreativeStudio's sala8.
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {ANTON, SANS, useFonts} from '../lib/fonts/1.0.0.js';
import {TEXT_SHADOW, TITLES} from '../lib/dentro-i-versi/1.0.0.js';
import {smoothstep} from '../lib/stage-math/1.0.0.js';

const LowerThird: KitVersion['component'] = ({props}) => {
  useFonts();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const ruleGrow = (props.ruleGrow as number | undefined) ?? 1.2;
  const maxWidth = props.maxWidth as number;
  return (
    <div style={{position: 'absolute', left: (props.x as number | undefined) ?? 90, top: ((props.bottom as number | undefined) ?? 1500), transform: 'translateY(-100%)'}}>
      <div style={{display: 'inline-flex', flexDirection: 'column', maxWidth, boxSizing: 'border-box', padding: '24px 36px 28px 30px', borderRadius: 16, background: TITLES.plate, border: '1px solid rgba(255,255,255,.45)', boxShadow: `0 10px 24px rgba(4,6,20,.45), inset 0 2px 0 ${TITLES.cyan}`}}>
        <div style={{fontFamily: SANS, fontWeight: 600, fontSize: 28, letterSpacing: 7, color: TITLES.cyan, lineHeight: 1.3, maxWidth: maxWidth - 66}}>{props.kicker as string}</div>
        <div style={{fontFamily: ANTON, fontSize: props.size as number, letterSpacing: 3, color: TITLES.text, lineHeight: 1, marginTop: 18, textShadow: TEXT_SHADOW, whiteSpace: 'nowrap', textTransform: 'uppercase'}}>
          {(props.titleLines as string[]).map((line, i) => <div key={i}>{line}</div>)}
        </div>
        <div style={{height: 3, background: TITLES.cyan, marginTop: 16, width: `${100 * (ruleGrow > 0 ? smoothstep(t / ruleGrow) : 1)}%`, boxShadow: `0 0 14px ${TITLES.cyan}`}} />
        <div style={{fontFamily: SANS, fontWeight: 400, fontSize: 30, color: TITLES.text, lineHeight: 1.25, marginTop: 16}}>{props.author as string}</div>
      </div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'lower-third',
  version: '1.0.0',
  description: "The poem's card for a 9:16 frame — eyebrow, title in Anton on one or two lines, a growing cyan rule, author — anchored by its bottom edge so it grows upwards.",
  layer: 'overlay',
  profiles: ['vertical-1080x1920'],
  props: z.object({
    kicker: z.string().min(1),
    titleLines: z.array(z.string().min(1)).min(1).max(2),
    author: z.string().min(1),
    /** The card's widest extent (the compiler keeps it clear of the actor). */
    maxWidth: z.number().positive(),
    /** Anton size of the title, fitted by the compiler to maxWidth. */
    size: z.number().positive().max(160),
    x: z.number().min(0).optional(),
    /** Where the card's bottom edge sits. */
    bottom: z.number().positive().optional(),
    /** Seconds the cyan rule takes to grow; 0: full. */
    ruleGrow: z.number().min(0).optional(),
  }).strict(),
  component: LowerThird,
  examples: [
    {id: 'opening', props: {kicker: 'GIOSUÈ CARDUCCI · RIME NUOVE', titleLines: ['SAN', 'MARTINO'], author: 'Giosuè Carducci', maxWidth: 557, size: 118}, durationInFrames: 60, frame: 45},
    {id: 'one-line', props: {kicker: 'GIOVANNI PASCOLI · MYRICAE', titleLines: ['IL LAMPO'], author: 'Giovanni Pascoli', maxWidth: 557, size: 104, ruleGrow: 0}, durationInFrames: 30, frame: 0},
    {id: 'rule-growing', props: {kicker: 'GIOSUÈ CARDUCCI', titleLines: ['SAN', 'MARTINO'], author: 'Giosuè Carducci', maxWidth: 557, size: 118}, durationInFrames: 60, frame: 12},
  ],
};
