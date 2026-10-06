// captions@1.1.0 — released: never edit this file; add captions/<next>.tsx instead.
// Same props as 1.0.0; the text block now stays inside the profile's safe zone.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';

const Captions: KitVersion['component'] = ({props, context}) => {
  const position = (props.position as 'top' | 'bottom' | 'center' | undefined) ?? 'bottom';
  const justify = position === 'top' ? 'flex-start' : position === 'center' ? 'center' : 'flex-end';
  const {top, right, bottom, left} = context.profile.safeZone;
  return (
    <AbsoluteFill style={{justifyContent: justify, alignItems: 'center', padding: `${top}px ${right}px ${bottom}px ${left}px`}}>
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
          boxSizing: 'border-box',
          overflowWrap: 'break-word',
        }}
      >
        {props.text as string}
      </div>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'captions',
  version: '1.1.0',
  description: "A block of text inside the output profile's safe zone, at its top, centre or bottom, on a translucent plate.",
  layer: 'overlay',
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
    {id: 'center', props: {text: 'Il lampo', position: 'center', fontSize: 96}, durationInFrames: 30, frame: 0},
    {
      id: 'long',
      props: {text: 'E cielo e terra si mostrò qual era: la terra ansante, livida, in sussulto; il cielo ingombro, tragico, disfatto.'},
      durationInFrames: 30,
      frame: 0,
    },
  ],
};
