// summary@1.0.0 — released: never edit this file; add summary/<next>.tsx instead.
// A lesson's summary (from CreativeStudio's poesie-museo-long): one row per
// picture on a full plate, its thumbnail on glass, its keyword and its figure,
// arriving as each keyword is said; then a closing line on a highlight edge and
// a flash that lights every thumbnail. Channel-neutral: the look is a prop
// (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ramp} from '../lib/stage-math/1.0.0.js';
import {AssetUrl} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {back} from '../lib/lesson-tools/1.0.0.js';

interface Row {src: string; focus?: [number, number]; keyword: string; figure: string; at: number}

const Summary: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const rows = props.rows as Row[];
  const closing = props.closing as {text: string; at: number} | undefined;
  const lit = props.lit as number | undefined;
  const X0 = (props.x as number | undefined) ?? 700;
  const Y0 = (props.y as number | undefined) ?? 130;
  const DY = Math.min(142, 710 / Math.max(5, rows.length));
  const room = 820 - 250 - 30;
  const kwSize = fitSize({family: look.fonts.display, weight: 400}, rows.map((r) => r.keyword), room, 52, () => 3);
  const figSize = fitSize({family: look.fonts.sans, weight: 600}, rows.map((r) => r.figure), room, 28, () => 3);
  const closeSize = closing ? fitSize({family: look.fonts.display, weight: 400}, [closing.text], 820 - 60, 84, () => 3) : 84;
  return (
    <AbsoluteFill>
      {rows.map((r, i) => {
        const slide = (1 - back((t - r.at) / 0.4)) * 40;
        const flash = lit === undefined ? 0 : strikeAt(t, [lit + i * 0.08]);
        const bx: Box = {x: X0 + 14, y: Y0 + 8 + i * DY, w: 200, h: 112};
        const [cx, cy] = r.focus ?? [0.5, 0.5];
        return (
          <div key={i} style={{position: 'absolute', inset: 0, opacity: ramp(t, r.at - 0.1, r.at + 0.3)}}>
            <div style={{position: 'absolute', left: X0, top: Y0 + i * DY, width: 820, height: 128, ...plateStyle(look), transform: `translateX(${slide}px)`}} />
            <Glass look={look} box={bx} t={t} on={ramp(t, r.at - 0.1, r.at + 0.3)} tilt={0} flash={flash}>
              <Cover src={r.src} box={{x: 0, y: 0, w: 180, h: 92}} cx={cx} cy={cy} filter={`brightness(${1 + 0.6 * flash})`} />
            </Glass>
            <div style={{position: 'absolute', left: X0 + 250, top: Y0 + i * DY + 18, transform: `translateX(${slide}px)`}}>
              <div style={{fontFamily: fonts.display, fontSize: kwSize, letterSpacing: 3, color: c.text, lineHeight: 1, whiteSpace: 'nowrap'}}>{r.keyword}</div>
              <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: figSize, letterSpacing: 3, color: c.glow, marginTop: 10, whiteSpace: 'nowrap'}}>{r.figure}</div>
            </div>
          </div>
        );
      })}
      {closing ? (
        <div style={{position: 'absolute', left: X0, top: Y0 + rows.length * DY + 10, opacity: ramp(t, closing.at - 0.1, closing.at + 0.3), padding: '12px 30px 16px', ...plateStyle(look, false), border: `1px solid ${c.highlight}`}}>
          <div style={{fontFamily: fonts.display, fontSize: closeSize, letterSpacing: 3, color: c.highlight, lineHeight: 1, whiteSpace: 'nowrap'}}>{closing.text}</div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const ROWS = [['REVELATION', 'REVELATION'], ['BODY', 'PERSONIFICATION'], ['FRACTURE', 'CLIMAX'], ['CONTRAST', 'OXYMORON'], ['LOOK', 'SIMILE']].map(([keyword, figure], i) => ({src: {$asset: i % 2 ? 'b' : 'a'}, keyword, figure, at: i * 0.5}));

export const kit: KitVersion = {
  name: 'summary',
  version: '1.0.0',
  description: "A lesson's summary in a 16:9 frame: one row per picture — thumbnail, keyword, figure — arriving as each keyword is said, a closing line and a flash that lights them all, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** The rows' left edge and top (default 700, 130: the empty side of the hall). */
    x: z.number().optional(),
    y: z.number().optional(),
    rows: z.array(z.object({src: AssetUrl, focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(), keyword: z.string().min(1).max(20), figure: z.string().min(1).max(40), at: z.number()}).strict()).min(1).max(8),
    closing: z.object({text: z.string().min(1).max(24), at: z.number()}).strict().optional(),
    /** Every thumbnail lights up from here, one after the other. */
    lit: z.number().optional(),
  }).strict(),
  component: Summary,
  examples: [
    {id: 'five', props: {look: DEMO_LOOK, rows: ROWS, closing: {text: 'STAY LIT.', at: 3}}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 120, frame: 105},
    {id: 'arriving', props: {look: DEMO_LOOK, rows: ROWS}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 60, frame: 32},
    {id: 'lit', props: {look: DEMO_LOOK, rows: ROWS, closing: {text: 'STAY LIT.', at: 3}, lit: 3.2}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 120, frame: 98},
  ],
};
