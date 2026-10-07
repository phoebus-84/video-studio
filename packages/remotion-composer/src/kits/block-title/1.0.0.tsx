// block-title@1.0.0 — released: never edit this file; add block-title/<next>.tsx instead.
// Opens a block of a lesson: kicker, title, a rule that grows, one line of
// information, on a full plate at the bottom left of a 16:9 frame (from
// CreativeStudio's poesie-museo-long LowerH). Channel-neutral: the look is a
// prop (ADR-0040); it fades through the timeline's transitions.
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ease} from '../lib/stage-math/1.0.0.js';

const BlockTitle: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const t = useCurrentFrame() / useVideoConfig().fps;
  const grow = (props.ruleGrow as number | undefined) ?? 0.6;
  const rule = grow > 0 ? ease((t - 0.3) / grow) : 1;
  const info = props.info as string | undefined;
  const x = (props.x as number | undefined) ?? 128;
  // the plate grows with its text: each line is sized so the plate — padding (56), border (2) and
  // shadow (24) included — ends inside the frame's right margin (96 px)
  const room = 1920 - 96 - x - 56 - 2 - 24;
  const kickerSize = fitSize({family: look.fonts.sans, weight: 600}, [props.kicker as string], room, 26, () => 6);
  const titleSize = fitSize({family: look.fonts.display, weight: 400}, [props.title as string], room, 54, () => 2);
  const infoSize = info ? fitSize({family: look.fonts.sans, weight: 400}, [info], room, 28) : 28;
  return (
    <div style={{position: 'absolute', left: x, bottom: 1080 - ((props.bottom as number | undefined) ?? 940)}}>
      <div style={{display: 'inline-flex', flexDirection: 'column', padding: '18px 30px 20px 26px', ...plateStyle(look, false)}}>
        <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: kickerSize, letterSpacing: 6, color: look.colors.accent, lineHeight: 1}}>{props.kicker as string}</div>
        <div style={{fontFamily: fonts.display, fontSize: titleSize, letterSpacing: 2, color: look.colors.text, lineHeight: 1, marginTop: 14, whiteSpace: 'nowrap'}}>{props.title as string}</div>
        <div style={{height: 2, background: look.colors.accent, marginTop: 12, width: `${100 * rule}%`}} />
        {info ? <div style={{fontFamily: fonts.sans, fontWeight: 400, fontSize: infoSize, color: look.colors.textDim, lineHeight: 1.2, marginTop: 12, whiteSpace: 'nowrap'}}>{info}</div> : null}
      </div>
    </div>
  );
};

export const kit: KitVersion = {
  name: 'block-title',
  version: '1.0.0',
  description: 'Opens a block of a lesson: kicker, title, a growing rule and one line of information on a plate at the bottom left of a 16:9 frame, in the channel theme\'s look.',
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    kicker: z.string().min(1).max(60),
    title: z.string().min(1).max(40),
    info: z.string().min(1).max(80).optional(),
    x: z.number().min(0).optional(),
    /** Where the plate's bottom edge sits. */
    bottom: z.number().positive().optional(),
    /** Seconds the rule takes to grow, from 0.3 s; 0: already drawn. */
    ruleGrow: z.number().min(0).optional(),
  }).strict(),
  component: BlockTitle,
  examples: [
    {id: 'opening', props: {look: DEMO_LOOK, kicker: 'CHAPTER I · THE CONTEXT', title: 'ITALY IN 1894', info: 'poverty, emigration, protest'}, durationInFrames: 60, frame: 45},
    {id: 'long', props: {look: DEMO_LOOK, kicker: 'CHAPTER IV · A KICKER LONG ENOUGH TO MATTER', title: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM', info: 'and a line of information that runs on for a good while longer'}, durationInFrames: 60, frame: 45},
    {id: 'rule-growing', props: {look: DEMO_LOOK, kicker: 'CHAPTER II', title: 'HOW IT WAS BORN'}, durationInFrames: 60, frame: 15},
  ],
};
