// interlinear@1.0.0 — released: never edit this file; add interlinear/<next>.tsx instead.
// A translation word under word (from CreativeStudio's poesie-museo-long note
// on the text): each foreign word lights when it is said, its translation
// under a thin rule when it is given; struck words turn to the signal colour,
// are crossed out and close up. Columns never compress: when the words do not
// fit the width, all of them shrink together. Channel-neutral: the look is a
// prop (ADR-0040).
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {textWidth} from '../lib/font-metrics/1.0.0.js';
import {ease, ramp} from '../lib/stage-math/1.0.0.js';

interface Word {text: string; gloss: string; at: number; glossAt: number}
const GAP = 26;

const Interlinear: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const words = props.words as Word[];
  const strike = props.strike as {indices: number[]; at: number} | undefined;
  const width = props.width as number;
  const serif = {family: look.fonts.serif, weight: 400, style: 'italic' as const};
  const sans = {family: look.fonts.sans, weight: 600};
  // each column as wide as the wider of its word and its translation
  const natural = words.reduce((s, w, i) => s + Math.max(textWidth(serif, w.text, 44), textWidth(sans, w.gloss, 30)) + (i ? GAP : 0), 0);
  const k = Math.min(1, width / natural);
  const drop = strike ? ease((t - strike.at - 0.2) / 0.8) : 0;
  return (
    <div style={{position: 'absolute', left: (props.x as number) - width / 2, top: props.y as number, width, display: 'flex', justifyContent: 'center', alignItems: 'flex-start'}}>
      {words.map((w, i) => {
        const on = ramp(t, w.at - 0.05, w.at + 0.2);
        const gOn = ramp(t, w.glossAt - 0.05, w.glossAt + 0.25);
        const struck = !!strike && strike.indices.includes(i);
        const cut = struck ? drop : 0;
        const red = struck && t > strike!.at;
        const col = Math.max(textWidth(serif, w.text, 44 * k), textWidth(sans, w.gloss, 30 * k));
        return (
          <div key={i} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 * k, marginLeft: i ? GAP * k * (1 - cut) : 0, opacity: 1 - cut, flexShrink: 0,
            width: col * (1 - cut), overflow: cut > 0 ? 'hidden' : 'visible'}}>
            <div style={{fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 44 * k, color: red ? c.signal : c.text, opacity: on, textShadow: look.measures.textShadow, whiteSpace: 'nowrap', textDecoration: red ? 'line-through' : 'none'}}>{w.text}</div>
            <div style={{width: '100%', height: 1.5, background: alpha(c.text, 0.45), opacity: gOn}} />
            <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 30 * k, color: red ? c.signal : c.glow, opacity: gOn, textShadow: look.measures.textShadow, whiteSpace: 'nowrap'}}>{w.gloss}</div>
          </div>
        );
      })}
    </div>
  );
};

const LATIN = [['Non', 'not'], ['omnis', 'everyone'], ['arbusta', 'shrubs'], ['iuvant', 'please'], ['humilesque', 'and the humble'], ['myricae', 'tamarisks']] as const;
const words = (from: number) => LATIN.map(([text, gloss], i) => ({text, gloss, at: from + i * 0.4, glossAt: from + 3 + i * 0.4}));

export const kit: KitVersion = {
  name: 'interlinear',
  version: '1.0.0',
  description: "A translation word under word in a 16:9 frame: each word lit when it is said, its translation under it, struck words crossed out in the signal colour and closed up, in the channel theme's look.",
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** The block's centre and top. */
    x: z.number(),
    y: z.number(),
    width: z.number().positive().max(1728),
    words: z.array(z.object({text: z.string().min(1).max(30), gloss: z.string().min(1).max(30), at: z.number(), glossAt: z.number()}).strict()
      .refine((w) => w.glossAt >= w.at, {message: 'a translation comes once its word is said', path: ['glossAt']})).min(1).max(10),
    strike: z.object({indices: z.array(z.number().int().min(0)).min(1), at: z.number()}).strict().optional(),
  }).strict().refine((p) => !p.strike || p.strike.indices.every((i) => i < p.words.length), {message: 'a struck word is one of the words', path: ['strike', 'indices']}),
  component: Interlinear,
  examples: [
    {id: 'glossed', props: {look: DEMO_LOOK, x: 970, y: 340, width: 1000, words: words(0)}, durationInFrames: 180, frame: 150},
    {id: 'said', props: {look: DEMO_LOOK, x: 970, y: 340, width: 1000, words: words(0)}, durationInFrames: 180, frame: 50},
    {id: 'struck', props: {look: DEMO_LOOK, x: 970, y: 340, width: 1000, words: words(0), strike: {indices: [0, 1], at: 5.5}}, durationInFrames: 240, frame: 200},
  ],
};
