// verse-bar@1.0.0 — released: never edit this file; add verse-bar/<next>.tsx instead.
// The verses being heard or discussed, always readable: one or more lines on
// a full plate across the lower middle of a 16:9 frame, words not yet said
// dimmed, said and strong words in the highlight colour, a kicker above
// (from CreativeStudio's poesie-museo-long VerseBar). Channel-neutral.
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';

interface Word {text: string; at?: number; hot?: boolean}

const VerseBar: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const t = useCurrentFrame() / useVideoConfig().fps;
  const w = (props.width as number | undefined) ?? 1240;
  const size = (props.size as number | undefined) ?? 54;
  const kicker = props.kicker as string | undefined;
  return (
    <div style={{position: 'absolute', left: 960 - w / 2, top: (props.y as number | undefined) ?? 790, width: w, display: 'flex', justifyContent: 'center'}}>
      <div style={{display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '16px 46px 20px', maxWidth: w, ...plateStyle(look), borderRadius: look.measures.plateRadius + 2}}>
        {kicker ? <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 26, letterSpacing: 6, color: look.colors.accent, lineHeight: 1}}>{kicker}</div> : null}
        {(props.lines as Word[][]).map((line, i) => (
          <div key={i} style={{fontFamily: fonts.serif, fontStyle: 'italic', fontSize: size, lineHeight: 1.15, whiteSpace: 'nowrap', color: look.colors.text}}>
            {line.map((word, j) => {
              const said = word.at === undefined || t >= word.at;
              return <span key={j} style={{color: word.hot && said ? look.colors.highlight : look.colors.text, opacity: said ? 1 : 0.5}}>{word.text}{j < line.length - 1 ? ' ' : ''}</span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

const WordSchema = z.object({text: z.string().min(1), at: z.number().min(0).optional(), hot: z.boolean().optional()}).strict();
const line = (s: string, hot: string[] = [], at?: number) => s.split(' ').map((text, i) => ({text, ...(hot.includes(text.replace(/[^\p{L}]/gu, '')) ? {hot: true} : {}), ...(at !== undefined ? {at: at + i * 0.35} : {})}));

export const kit: KitVersion = {
  name: 'verse-bar',
  version: '1.0.0',
  description: 'The verses heard or discussed, on a full plate across the lower middle of a 16:9 frame: unsaid words dimmed, said and strong words highlighted, a kicker above, in the channel theme\'s look.',
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** Lines of words; a word with `at` is dimmed until then (seconds from the item's start). */
    lines: z.array(z.array(WordSchema).min(1)).min(1).max(3),
    kicker: z.string().min(1).max(60).optional(),
    y: z.number().min(0).optional(),
    size: z.number().positive().max(80).optional(),
    width: z.number().positive().max(1728).optional(),
  }).strict(),
  component: VerseBar,
  examples: [
    {id: 'one-verse', props: {look: DEMO_LOOK, kicker: 'THE POEM · VERSE 1 OF 7', lines: [line('And sky and earth showed what they were:', ['sky', 'earth'])]}, durationInFrames: 60, frame: 30},
    {id: 'being-said', props: {look: DEMO_LOOK, lines: [line('the earth gasping, livid, in turmoil,', ['earth'], 0.2)]}, durationInFrames: 90, frame: 40},
    {id: 'two-verses', props: {look: DEMO_LOOK, kicker: 'METRE', lines: [line('the sky cluttered, tragic, worn;'), line('white, white in the silent tumult', ['white'])], size: 46, y: 772}, durationInFrames: 60, frame: 30},
  ],
};
