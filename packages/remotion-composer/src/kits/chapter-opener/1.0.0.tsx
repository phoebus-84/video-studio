// chapter-opener@1.0.0 — released: never edit this file; add chapter-opener/<next>.tsx instead.
// The pause between two chapters of a lesson: a flash, a dark veil, the
// chapter's kicker, its title closing in, a light rule, its subtitle (from
// CreativeStudio's poesie-museo-long chapter card). Channel-neutral: every
// word, including "chapter", is a prop.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {clamp, ease} from '../lib/stage-math/1.0.0.js';
import {strikeAt} from '../lib/lesson-stage/1.0.0.js';

const ChapterOpener: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const k = ease((t - 0.35) / 0.8);
  const flash = strikeAt(t, [0]);
  const sub = props.sub as string | undefined;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: '#000000'}} />
      <AbsoluteFill style={{background: `radial-gradient(1200px 700px at 50% 45%, ${alpha(c.backdrop, 1)}, ${alpha(c.backdrop, 0.38)})`}} />
      <AbsoluteFill style={{background: alpha(c.glow, 0.55 * flash), mixBlendMode: 'screen'}} />
      <div style={{position: 'absolute', left: 0, right: 0, top: 330, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: clamp(t / 0.3)}}>
        <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 28, letterSpacing: 10, color: c.accent}}>{props.kicker as string}</div>
        <div style={{fontFamily: fonts.display, fontSize: 150, letterSpacing: (1 - k) * 30 + 6, color: c.text, lineHeight: 1, marginTop: 24, textShadow: look.measures.textShadow, whiteSpace: 'nowrap'}}>{props.title as string}</div>
        <div style={{width: 640 * k, height: 2, background: c.accent, marginTop: 26, boxShadow: `0 0 18px ${c.accent}`}} />
        {sub ? <div style={{fontFamily: fonts.sans, fontWeight: 400, fontSize: 38, color: c.text, marginTop: 28}}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'chapter-opener',
  version: '1.0.0',
  description: 'The pause between two chapters of a 16:9 lesson: a flash, a dark veil, the chapter kicker, its title closing in, a light rule and a subtitle, in the channel theme\'s look.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    kicker: z.string().min(1).max(30),
    title: z.string().min(1).max(20),
    sub: z.string().min(1).max(60).optional(),
  }).strict(),
  component: ChapterOpener,
  examples: [
    {id: 'settled', props: {look: DEMO_LOOK, kicker: 'CHAPTER I', title: 'THE CONTEXT', sub: 'Italy in 1894 · how the poem was born'}, durationInFrames: 120, frame: 60},
    {id: 'flash', props: {look: DEMO_LOOK, kicker: 'CHAPTER III', title: 'THE METRE'}, durationInFrames: 120, frame: 2},
  ],
};
