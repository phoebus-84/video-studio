import React from 'react';
import {Composition} from 'remotion';
import {Timeline, type TimelineProps} from './Timeline.js';
import {Sheet, sheetSize, type SheetProps} from './Sheet.js';

const preview: TimelineProps = {
  timeline: {
    apiVersion: 'studio.video/v1alpha2',
    kind: 'EditTimeline',
    episodeRef: {channel: 'preview', series: 'preview', episode: 'preview'},
    revision: 1,
    fps: 30,
    durationInFrames: 30,
    resolution: {width: 1920, height: 1080},
    profile: {
      id: 'preview', width: 1920, height: 1080,
      safeZone: {top: 0, right: 0, bottom: 0, left: 0},
      loudness: {integrated: -15, truePeak: -1, range: 11},
    },
    assets: {},
    tracks: [{id: 'main', type: 'visual', z: 0, items: []}],
  },
  files: {},
  assetFrames: {},
};

const emptySheet: SheetProps = {tiles: [], columns: 1, tileWidth: 480, tileHeight: 270};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Timeline"
      component={Timeline}
      durationInFrames={preview.timeline.durationInFrames}
      fps={preview.timeline.fps}
      width={preview.timeline.resolution.width}
      height={preview.timeline.resolution.height}
      defaultProps={preview}
      calculateMetadata={({props}) => ({
        durationInFrames: props.timeline.durationInFrames,
        fps: props.timeline.fps,
        width: props.timeline.resolution.width,
        height: props.timeline.resolution.height,
      })}
    />
    <Composition
      id="Sheet"
      component={Sheet}
      durationInFrames={1}
      fps={30}
      width={sheetSize(emptySheet).width}
      height={sheetSize(emptySheet).height}
      defaultProps={emptySheet}
      calculateMetadata={({props}) => ({...sheetSize(props), durationInFrames: 1, fps: 30})}
    />
  </>
);
