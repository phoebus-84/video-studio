// verse-plate@1.0.0 — released: never edit this file; add verse-plate/<next>.tsx instead.
// One verse on a light, opaque plate (Dentro i versi, from CreativeStudio's
// sala8, mode "sober"): the whole verse visible from the start, each word
// dimmed until it is said and then lit; strong words bold, turning violet;
// a cyan rule that grows; the paraphrase visible for the whole verse
// (UP-55, UP-59). No word moves. The plate's top sits at `y` and it grows
// upwards when it would pass `bottom`; its shadow is kept short so every
// pixel stays in the safe zone.
import React from 'react';
import {interpolateColors, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {SANS, SERIF, useFonts} from '../lib/fonts/1.0.0.js';
import {HALL} from '../lib/dentro-i-versi/1.0.0.js';
import {ease} from '../lib/stage-math/1.0.0.js';

/** A word as `strong` lists it: lower case, letters only. */
const key = (token: string) => token.toLocaleLowerCase('it-IT').replace(/[^\p{L}]+/gu, '');
const tokens = (text: string) => text.split(/\s+/).filter(Boolean);

const VersePlate: KitVersion['component'] = ({props}) => {
  useFonts();
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const text = props.text as string;
  const words = props.words as {text: string; at: number}[];
  const strong = new Set((props.strong as string[] | undefined) ?? []);
  const dim = (props.dim as number | undefined) ?? 0.42;
  const start = (props.start as number | undefined) ?? 0.28;
  const enter = (props.enter as number | undefined) ?? 0.27;
  const y = (props.y as number | undefined) ?? 1240;
  const bottom = (props.bottom as number | undefined) ?? 1500;
  const vIn = enter > 0 ? ease(t / enter) : 1;
  let k = 0;
  const verse = text.split(/(\s+)/).map((token, i) => {
    if (!token.trim()) return token;
    const at = words[k++]?.at ?? start;
    const q = ease((t - at + 0.04) / 0.22);
    const isStrong = strong.has(key(token));
    return (
      <span key={i} style={{opacity: dim + (1 - dim) * q, fontWeight: isStrong ? 700 : 400, color: isStrong ? interpolateColors(q, [0, 1], [HALL.ink, HALL.accent]) : HALL.ink}}>
        {token}
      </span>
    );
  });
  const gloss = ease((t - start - 0.1) / 0.45);
  return (
    <div style={{position: 'absolute', left: (props.x as number | undefined) ?? 90, bottom: 1920 - bottom, width: (props.width as number | undefined) ?? 500, minHeight: bottom - y, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', opacity: vIn, transform: `translateY(${16 * (1 - vIn)}px)`}}>
      <div style={{padding: '20px 16px 24px', borderRadius: 16, background: 'rgb(248,250,255)', border: '1px solid #ffffff', boxShadow: `0 10px 24px rgba(10,16,50,.3), inset 0 3px 0 ${HALL.cyan}`}}>
        <div style={{fontFamily: SERIF, fontStyle: 'italic', fontSize: 46, lineHeight: 1.2, textAlign: 'center', whiteSpace: 'pre-line', color: HALL.ink}}>
          <span>{verse}</span>
        </div>
        <div style={{margin: '12px auto 0', width: 72 * ease((t - start) / 0.5), height: 4, borderRadius: 2, background: HALL.cyan, boxShadow: `0 0 10px ${HALL.cyan}`}} />
        <div style={{marginTop: 18, textAlign: 'center', fontFamily: SANS, fontWeight: 400, fontSize: 30, lineHeight: 1.26, color: HALL.ink2, opacity: gloss, transform: `translateY(${(1 - gloss) * 10}px)`}}>
          {props.gloss as string}
        </div>
      </div>
    </div>
  );
};

const Props = z.object({
  /** The verse as written; lines by \n. */
  text: z.string().min(1),
  /** One per word of `text`, in order: when it is said, in seconds from the item's start. */
  words: z.array(z.object({text: z.string().min(1), at: z.number().min(0)}).strict()),
  /** Words to set bold and violet, lower case, letters only. */
  strong: z.array(z.string().min(1)).optional(),
  /** The paraphrase. */
  gloss: z.string().min(1),
  /** When the verse starts being said, in seconds from the item's start (the rule and the paraphrase start then). */
  start: z.number().min(0).optional(),
  /** Seconds the plate takes to rise in; 0: already there. */
  enter: z.number().min(0).optional(),
  /** Opacity of a word not yet said. */
  dim: z.number().min(0).max(1).optional(),
  x: z.number().min(0).optional(),
  /** Where the plate's top sits when it fits. */
  y: z.number().min(0).optional(),
  /** The lowest its bottom edge may go: above it, the plate grows upwards. */
  bottom: z.number().positive().optional(),
  width: z.number().positive().optional(),
}).strict().superRefine((p, ctx) => {
  const expected = tokens(p.text).length;
  if (p.words.length !== expected) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['words'], message: `the verse has ${expected} words; words lists ${p.words.length}`});
  }
});

const SAN_MARTINO = {
  text: 'La nebbia\nagli irti colli\npiovigginando sale,',
  words: [['La', 0.28], ['nebbia', 0.5], ['agli', 1.3], ['irti', 1.6], ['colli', 1.9], ['piovigginando', 2.9], ['sale,', 3.8]].map(([text, at]) => ({text, at})),
  strong: ['nebbia', 'colli'],
  gloss: 'La nebbia sale sui colli spogli, con una pioggia fine,',
};

export const kit: KitVersion = {
  name: 'verse-plate',
  version: '1.0.0',
  description: 'One verse on a light plate in a 9:16 frame: the whole verse visible, each word lit when it is said, strong words bold and violet, the paraphrase below for the whole verse.',
  layer: 'overlay',
  profiles: ['vertical-1080x1920'],
  props: Props,
  component: VersePlate,
  examples: [
    // Halfway: "La nebbia agli irti" said, "colli" being said, the rest dim.
    {id: 'halfway', props: SAN_MARTINO, durationInFrames: 150, frame: 58},
    {id: 'all-said', props: SAN_MARTINO, durationInFrames: 150, frame: 140},
    {
      id: 'long',
      props: {
        text: 'stormi d\'uccelli neri,\ncom\'esuli pensieri,\nnel vespero migrar.',
        words: ['stormi', 'd\'uccelli', 'neri,', 'com\'esuli', 'pensieri,', 'nel', 'vespero', 'migrar.'].map((text, i) => ({text, at: 0.28 + i * 0.4})),
        strong: ['uccelli', 'pensieri'],
        gloss: 'stormi di uccelli neri che, come pensieri di chi è in esilio, migrano verso la sera.',
      },
      durationInFrames: 150,
      frame: 149,
    },
  ],
};
