import React from 'react';
import {AbsoluteFill, Img} from 'remotion';
import type {KitContext} from './registry.js';

/** An image filling the frame. */
export const Still: React.FC<{props: Record<string, unknown>; context: KitContext}> = ({props}) => {
  const src = props.src as string;
  const fit = (props.fit as 'cover' | 'contain' | undefined) ?? 'cover';
  const scale = (props.scale as number | undefined) ?? 1;
  return (
    <AbsoluteFill>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: fit, transform: `scale(${scale})`}} />
    </AbsoluteFill>
  );
};
