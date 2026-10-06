// still@1.0.0 — released: never edit this file; add still/<next>.tsx instead.
import React from 'react';
import {AbsoluteFill, Img} from 'remotion';
import {z} from 'zod';
import {AssetRef, type KitVersion} from '../types.js';

const Still: KitVersion['component'] = ({props}) => {
  const src = props.src as string;
  const fit = (props.fit as 'cover' | 'contain' | undefined) ?? 'cover';
  const scale = (props.scale as number | undefined) ?? 1;
  return (
    <AbsoluteFill>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: fit, transform: `scale(${scale})`}} />
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'still',
  version: '1.0.0',
  description: 'An image filling the frame, covering it or contained in it, optionally scaled.',
  props: z.object({src: AssetRef, fit: z.enum(['cover', 'contain']).optional(), scale: z.number().positive().optional()}).strict(),
  component: Still,
  examples: [
    {id: 'cover', props: {src: {$asset: 'image'}, fit: 'cover'}, durationInFrames: 30, frame: 0, samples: {image: 'sample.png'}},
    {id: 'contain', props: {src: {$asset: 'image'}, fit: 'contain', scale: 0.8}, durationInFrames: 30, frame: 0, samples: {image: 'sample.png'}},
  ],
};
