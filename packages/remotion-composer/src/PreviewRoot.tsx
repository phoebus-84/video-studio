// One composition per example of every kit version: what the one-frame tests
// and the previews render. Example $asset ids resolve to files in kits/samples/.
// The output profile arrives in inputProps (the catalog is the contracts', read
// by the tests and the previews script), and sets the composition's size; with
// `transparent` the example is drawn on nothing, so its drawn pixels can be
// measured against the safe zone.

import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {KIT_VERSIONS, previewCompositionId, type KitExample, type KitProfile, type KitVersion} from './kits/index.js';
import {resolveAssets} from './Timeline.js';

export interface ExampleProps {
  name: string;
  version: string;
  example: string;
  profile: KitProfile;
  transparent?: boolean;
  /** Index signature Remotion's Composition requires of its props. */
  [key: string]: unknown;
}

/** Used only when no profile is given: a plain 16:9 frame with no safe zone. */
const FALLBACK_PROFILE: KitProfile = {id: 'preview', width: 1920, height: 1080, safeZone: {top: 0, right: 0, bottom: 0, left: 0}};

const Example: React.FC<ExampleProps> = ({name, version, example, profile, transparent}) => {
  const kit = KIT_VERSIONS.find((k) => k.name === name && k.version === version)!;
  const ex = kit.examples.find((e) => e.id === example)!;
  const Kit = kit.component;
  return (
    <AbsoluteFill style={transparent ? {} : {backgroundColor: '#000000'}}>
      <Kit props={resolveAssets(ex.props, ex.samples ?? {}) as Record<string, unknown>} context={{assetFrames: {}, profile}} />
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
    width={FALLBACK_PROFILE.width}
    height={FALLBACK_PROFILE.height}
    defaultProps={{name: kit.name, version: kit.version, example: example.id, profile: FALLBACK_PROFILE} as ExampleProps}
    calculateMetadata={({props}) => ({width: props.profile.width, height: props.profile.height})}
  />
);

export const PreviewRoot: React.FC = () => <>{KIT_VERSIONS.flatMap((kit) => kit.examples.map((example) => compositions(kit, example)))}</>;
