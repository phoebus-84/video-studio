import React from 'react';
import {AbsoluteFill, Freeze, OffthreadVideo, useCurrentFrame} from 'remotion';
import type {KitContext} from './registry.js';

/**
 * A video filling the frame, muted: its sound belongs on an audio track.
 * When the item outlasts the clip, its last frame holds.
 */
export const Clip: React.FC<{props: Record<string, unknown>; context: KitContext}> = ({props, context}) => {
  const frame = useCurrentFrame();
  const src = props.src as string;
  const fit = (props.fit as 'cover' | 'contain' | undefined) ?? 'cover';
  const last = (context.assetFrames[src] ?? Number.POSITIVE_INFINITY) - 1;
  const video = <OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: fit}} />;
  return <AbsoluteFill>{frame > last ? <Freeze frame={last}>{video}</Freeze> : video}</AbsoluteFill>;
};
