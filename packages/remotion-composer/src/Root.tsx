import React from 'react';
import {Composition} from 'remotion';
import {Timeline, type TimelineProps} from './Timeline.js';

const preview: TimelineProps = {
  timeline: {
    apiVersion: 'studio.video/v1alpha2',
    kind: 'EditTimeline',
    episodeRef: {channel: 'preview', series: 'preview', episode: 'preview'},
    revision: 1,
    fps: 30,
    durationInFrames: 30,
    resolution: {width: 1920, height: 1080},
    assets: {},
    tracks: [{id: 'main', type: 'visual', z: 0, items: []}],
  },
  files: {},
  assetFrames: {},
};

export const RemotionRoot: React.FC = () => (
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
);
