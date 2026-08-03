import React from 'react';
import {Composition} from 'remotion';
import {InfographicVideo} from './InfographicVideo.js';
import {getDurationInFrames, type InfographicSpec} from './schema.js';

const defaultSpec: InfographicSpec = {
  version: 1,
  name: 'Infographic preview',
  width: 1920,
  height: 1080,
  fps: 30,
  palette: {
    ink: '#0D0B16',
    paper: '#FEFBF6',
    primary: '#423E8E',
    secondary: '#211F47',
    accent: '#D77733',
    muted: '#8A879B',
  },
  scenes: [{
    id: 'preview',
    template: 'title',
    durationInFrames: 150,
    title: 'Infographic',
    subtitle: 'Pass a validated production spec to render a complete motion graphic.',
    items: [],
  }],
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Infographic"
    component={InfographicVideo}
    durationInFrames={getDurationInFrames(defaultSpec)}
    fps={defaultSpec.fps}
    width={defaultSpec.width}
    height={defaultSpec.height}
    defaultProps={{spec: defaultSpec}}
    calculateMetadata={({props}) => ({
      durationInFrames: getDurationInFrames(props.spec),
      fps: props.spec.fps,
      width: props.spec.width,
      height: props.spec.height,
    })}
  />
);
