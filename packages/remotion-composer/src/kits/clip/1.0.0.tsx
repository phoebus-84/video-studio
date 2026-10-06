// clip@1.0.0 — released: never edit this file; add clip/<next>.tsx instead.
import React from 'react';
import {AbsoluteFill, Freeze, OffthreadVideo, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {AssetRef, type KitVersion} from '../types.js';

/** A video filling the frame, muted (its sound belongs on an audio track); its last frame holds when the item outlasts it. */
const Clip: KitVersion['component'] = ({props, context}) => {
  const frame = useCurrentFrame();
  const src = props.src as string;
  const fit = (props.fit as 'cover' | 'contain' | undefined) ?? 'cover';
  const last = (context.assetFrames[src] ?? Number.POSITIVE_INFINITY) - 1;
  const video = <OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: fit}} />;
  return <AbsoluteFill>{frame > last ? <Freeze frame={last}>{video}</Freeze> : video}</AbsoluteFill>;
};

export const kit: KitVersion = {
  name: 'clip',
  version: '1.0.0',
  description: 'A muted video filling the frame; its last frame holds when the item outlasts the clip.',
  props: z.object({src: AssetRef, fit: z.enum(['cover', 'contain']).optional()}).strict(),
  component: Clip,
  examples: [{id: 'plays', props: {src: {$asset: 'video'}}, durationInFrames: 30, frame: 15, samples: {video: 'sample.mp4'}}],
};
