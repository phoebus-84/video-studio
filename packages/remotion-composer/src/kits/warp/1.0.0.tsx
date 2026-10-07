// warp@1.0.0 — released: never edit this file; add warp/<next>.tsx instead.
// The passage between two rooms: a flash with radial streaks that rises to
// its peak — where the room underneath changes — and fades (from
// CreativeStudio's poesie-museo-long Warp). Channel-neutral.
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, type Look} from '../lib/look/1.0.0.js';
import {ramp} from '../lib/stage-math/1.0.0.js';
import {WarpLayer} from '../lib/lesson-stage/1.0.0.js';

const Warp: KitVersion['component'] = ({props}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const end = durationInFrames / fps;
  const rise = (props.rise as number | undefined) ?? 0.55;
  const fall = (props.fall as number | undefined) ?? 0.65;
  const k = ramp(t, 0, Math.min(rise, end / 2)) * (1 - ramp(t, end - Math.min(fall, end / 2), end));
  return <AbsoluteFill><WarpLayer look={props.look as Look} k={k} /></AbsoluteFill>;
};

export const kit: KitVersion = {
  name: 'warp',
  version: '1.0.0',
  description: 'The passage between two rooms of a 16:9 lesson: a flash with radial streaks rising over the item and fading out, the room changing under its peak, in the channel theme\'s look.',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** Seconds from the item's start to full flash, and from full flash to its end. */
    rise: z.number().positive().optional(),
    fall: z.number().positive().optional(),
  }).strict(),
  component: Warp,
  examples: [
    {id: 'peak', props: {look: DEMO_LOOK}, durationInFrames: 36, frame: 18},
    {id: 'rising', props: {look: DEMO_LOOK}, durationInFrames: 36, frame: 8},
  ],
};
