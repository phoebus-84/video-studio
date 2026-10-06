// captions@1.0.0 — released: never edit this file; add captions/<next>.tsx instead.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';

const Captions: KitVersion['component'] = ({props}) => {
  const position = (props.position as 'top' | 'bottom' | 'center' | undefined) ?? 'bottom';
  const justify = position === 'top' ? 'flex-start' : position === 'center' ? 'center' : 'flex-end';
  return (
    <AbsoluteFill style={{justifyContent: justify, alignItems: 'center', padding: '6% 8%'}}>
      <div
        style={{
          fontFamily: (props.font as string | undefined) ?? 'Inter, Helvetica, Arial, sans-serif',
          fontSize: (props.fontSize as number | undefined) ?? 56,
          lineHeight: 1.25,
          color: (props.color as string | undefined) ?? '#ffffff',
          backgroundColor: (props.backgroundColor as string | undefined) ?? 'rgba(0, 0, 0, 0.55)',
          padding: '0.35em 0.6em',
          borderRadius: '0.25em',
          textAlign: 'center',
          maxWidth: '100%',
        }}
      >
        {props.text as string}
      </div>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'captions',
  version: '1.0.0',
  description: 'A block of text in the safe area, at the top, centre or bottom, on a translucent plate.',
  props: z.object({
    text: z.string().min(1),
    position: z.enum(['top', 'bottom', 'center']).optional(),
    fontSize: z.number().positive().optional(),
    color: z.string().min(1).optional(),
    backgroundColor: z.string().min(1).optional(),
    font: z.string().min(1).optional(),
  }).strict(),
  component: Captions,
  examples: [
    {id: 'bottom', props: {text: 'Once upon a time, in a village by the woods…'}, durationInFrames: 30, frame: 0},
    {id: 'top', props: {text: 'Chapter one', position: 'top', fontSize: 72, backgroundColor: '#1b1f3b'}, durationInFrames: 30, frame: 0},
  ],
};
