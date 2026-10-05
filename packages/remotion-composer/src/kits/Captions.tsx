import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {KitContext} from './registry.js';

/** A block of text in the frame's safe area. */
export const Captions: React.FC<{props: Record<string, unknown>; context: KitContext}> = ({props}) => {
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
