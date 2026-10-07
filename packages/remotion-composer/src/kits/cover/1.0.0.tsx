// cover@1.0.0 — released: never edit this file; add cover/<next>.tsx instead.
// The cover a video opens and closes on, readable as a thumbnail: a kicker
// on the highlight colour, the title huge in the display font with an icon,
// two hook lines, over a dark gradient on the left of a 16:9 frame (from
// CreativeStudio's poesie-museo-long Thumb). Channel-neutral. It fills the
// frame (the gradient covers it all); its texts sit inside the safe zone.
import React from 'react';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';

const Cover: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const title = props.titleLines as string[];
  const hooks = (props.hookLines as string[] | undefined) ?? [];
  const kicker = props.kicker as string | undefined;
  // everything stays left of the gradient's fade (900 px wide from x 120), the icon beside the title
  const display = {family: look.fonts.display, weight: 400};
  const size = fitSize(display, title, 900 - (props.icon === 'bolt' ? 120 : 0), 236, () => 4);
  // the bolt hangs beside the title and down over the first hook line: hooks keep clear of it
  const hookSize = fitSize(display, hooks, 900 - (props.icon === 'bolt' ? 120 : 0), 70, () => 2);
  const kickerSize = kicker ? fitSize({family: look.fonts.sans, weight: 600}, [kicker], 900 - 44, 34, () => 8) : 34;
  const shade = '0 4px 0 rgba(0,0,0,.6), 0 8px 30px rgba(0,0,0,.55)';
  return (
    <div style={{position: 'absolute', inset: 0}}>
      <div style={{position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${alpha(c.backdrop, 0.86)} 0%, ${alpha(c.backdrop, 0.62)} 38%, ${alpha(c.backdrop, 0)} 58%)`}} />
      <div style={{position: 'absolute', left: 120, top: 190, display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
        {kicker ? <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: kickerSize, letterSpacing: 8, color: c.ink, background: c.highlight, padding: '10px 22px 11px', borderRadius: 10}}>{kicker}</div> : null}
        <div style={{position: 'relative', fontFamily: fonts.display, fontSize: size, lineHeight: 0.92, color: c.text, marginTop: 26, letterSpacing: 4, textShadow: `0 0 28px ${c.accent}, 0 6px 0 rgba(0,0,0,.7), 0 12px 40px rgba(0,0,0,.6)`}}>
          {title.map((w, i) => <React.Fragment key={i}>{i ? <br /> : null}{w}</React.Fragment>)}
          {props.icon === 'bolt' ? (
            <svg width="180" height="300" viewBox="0 0 180 300" style={{position: 'absolute', right: -150, top: 40, filter: `drop-shadow(0 0 18px ${c.accent})`}}>
              <path d="M110 0 L20 170 H82 L50 300 L170 110 H104 Z" fill={c.highlight} stroke="#fff" strokeWidth="5" strokeLinejoin="round" />
            </svg>
          ) : null}
        </div>
        {hooks.map((l, i) => <div key={i} style={{fontFamily: fonts.display, fontSize: hookSize, letterSpacing: 2, color: i ? c.text : c.highlight, marginTop: i ? 6 : 26, lineHeight: 1, textShadow: shade}}>{l}</div>)}
      </div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'cover',
  version: '1.0.0',
  description: 'The cover a 16:9 video opens and closes on, readable as a thumbnail: kicker, huge title with an icon, two hook lines, over a dark gradient on the left, in the channel theme\'s look.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    kicker: z.string().min(1).max(30).optional(),
    titleLines: z.array(z.string().min(1).max(14)).min(1).max(2),
    hookLines: z.array(z.string().min(1).max(24)).max(2).optional(),
    icon: z.enum(['bolt', 'none']).optional(),
  }).strict(),
  component: Cover,
  examples: [
    {id: 'two-lines', props: {look: DEMO_LOOK, kicker: 'POET · 7 VERSES', titleLines: ['THE', 'FLASH'], hookLines: ['1 SECOND', 'IN SLOW MOTION'], icon: 'bolt'}, durationInFrames: 30, frame: 0},
    {id: 'wide', props: {look: DEMO_LOOK, kicker: 'A KICKER OF THIRTY CHARACTERS', titleLines: ['MMMMMMMMMMMMMM', 'WWWWWWWWWWWWWW'], hookLines: ['MMMMMMMMMMMMMMMMMMMMMMMM', 'A HOOK OF TWENTY-FOUR CH'], icon: 'bolt'}, durationInFrames: 30, frame: 0},
    {id: 'one-line', props: {look: DEMO_LOOK, titleLines: ['INFINITY'], hookLines: ['A HEDGE', 'AND THE ENDLESS']}, durationInFrames: 30, frame: 0},
  ],
};
