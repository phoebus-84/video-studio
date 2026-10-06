// One composition per example of every kit version: what the one-frame tests
// and the previews render. Example $asset ids resolve to files in kits/samples/.

import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {KIT_VERSIONS, previewCompositionId, type KitExample, type KitVersion} from './kits/index.js';
import {resolveAssets} from './Timeline.js';

const Example: React.FC<{name: string; version: string; example: string}> = ({name, version, example}) => {
  const kit = KIT_VERSIONS.find((k) => k.name === name && k.version === version)!;
  const ex = kit.examples.find((e) => e.id === example)!;
  const Kit = kit.component;
  return (
    <AbsoluteFill style={{backgroundColor: '#000000'}}>
      <Kit props={resolveAssets(ex.props, ex.samples ?? {}) as Record<string, unknown>} context={{assetFrames: {}}} />
    </AbsoluteFill>
  );
};

const compositions = (kit: KitVersion, example: KitExample) => (
  <Composition
    key={previewCompositionId(kit.name, kit.version, example.id)}
    id={previewCompositionId(kit.name, kit.version, example.id)}
    component={Example}
    durationInFrames={example.durationInFrames}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{name: kit.name, version: kit.version, example: example.id}}
  />
);

export const PreviewRoot: React.FC = () => <>{KIT_VERSIONS.flatMap((kit) => kit.examples.map((example) => compositions(kit, example)))}</>;
