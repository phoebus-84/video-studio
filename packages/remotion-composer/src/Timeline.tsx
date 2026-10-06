// The root composition: visual tracks in z order, one Sequence per item with
// its kit; fades and crossfades as opacity; audio items as <Audio> with a
// per-frame volume.

import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {resolveKit, type KitProfile} from './kits/index.js';
import type {AudioItem, EditTimeline, VisualItem} from './schema.js';
import {isAudioItem} from './schema.js';
import {itemVolume} from './volume.js';
import {visualLayers} from './layers.js';

export interface TimelineProps {
  timeline: EditTimeline;
  /** Asset id → file name in the staged public directory. */
  files: Record<string, string>;
  /** Staged file name → how many frames that video lasts (for kits that freeze at its end). */
  assetFrames: Record<string, number>;
  /** Index signature Remotion's Composition requires of its props. */
  [key: string]: unknown;
}

/** Replace every `{ "$asset": id }` with the staged file's URL. */
export function resolveAssets(value: unknown, files: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveAssets(v, files));
  if (value && typeof value === 'object') {
    const asset = (value as {$asset?: unknown}).$asset;
    if (typeof asset === 'string' && Object.keys(value).length === 1) return staticFile(files[asset] ?? asset);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveAssets(v, files)]));
  }
  return value;
}

const ItemLayer: React.FC<{item: VisualItem; files: Record<string, string>; assetFrames: Record<string, number>; profile: KitProfile}> = ({item, files, assetFrames, profile}) => {
  const frame = useCurrentFrame();
  let opacity = 1;
  if (item.transitionIn) opacity = Math.min(opacity, Math.min(1, frame / item.transitionIn.duration));
  if (item.transitionOut) opacity = Math.min(opacity, Math.min(1, (item.duration - frame) / item.transitionOut.duration));
  const kit = resolveKit(item.kit.name, item.kit.version)!;
  const Kit = kit.component;
  // Kits see URLs, so the frame counts are keyed by URL too.
  const byUrl = Object.fromEntries(Object.entries(assetFrames).map(([file, frames]) => [staticFile(file), frames]));
  return (
    <AbsoluteFill style={{opacity}}>
      <Kit props={resolveAssets(item.props, files) as Record<string, unknown>} context={{assetFrames: byUrl, profile}} />
    </AbsoluteFill>
  );
};

export const Timeline: React.FC<TimelineProps> = ({timeline, files, assetFrames}) => (
  <AbsoluteFill style={{backgroundColor: '#000000'}}>
    {visualLayers(timeline).map(({track, item}) => (
      <Sequence key={`${track.id}/${item.id}`} from={item.from} durationInFrames={item.duration}>
        <ItemLayer item={item} files={files} assetFrames={assetFrames} profile={timeline.profile} />
      </Sequence>
    ))}
    {timeline.tracks
      .filter((track) => track.type === 'audio' && !track.muted)
      .map((track) =>
        track.items.filter(isAudioItem).map((item: AudioItem) => (
          <Sequence key={`${track.id}/${item.id}`} from={item.from} durationInFrames={item.duration}>
            <Audio src={staticFile(files[item.asset] ?? item.asset)} startFrom={item.trimStart ?? 0} volume={itemVolume(item, track, timeline)} />
          </Sequence>
        )),
      )}
  </AbsoluteFill>
);
