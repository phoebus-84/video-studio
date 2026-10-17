// Opt-in parity at the Remotion boundary: listed library-kit sounds, loops,
// negative offsets, trims, volume callbacks, and two assets sharing a file.
import {it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {sha256} from '../src/assets.js';
import {cacheTimeline} from './cache-fixture.js';
import {buildLibraryKit} from './library-kit-fixture.js';

const SOUND_KIT = `
import React from 'react';
import {Audio, Sequence} from 'remotion';
import {z} from 'zod';
const sounds = (props, context) => [
  {src: props.src, from: -4, durationInFrames: 70, trimBefore: 3, loop: true,
    volume: (f) => context.profile.width / 3200 + (f % 5) / 20},
  {src: props.alias, from: -4, durationInFrames: 70, trimBefore: 3, loop: true, volume: 0.25},
  {src: props.src, from: 15, durationInFrames: 20, volume: (f) => f < 3 ? 0 : 0.3},
];
export const kit = {
  name: 'listed-sounds', version: '1.0.0', description: 'Sound-pass parity fixture',
  props: z.object({src: z.object({$asset: z.string()}), alias: z.object({$asset: z.string()})}),
  sound: true, sounds, examples: [],
  component: ({props, context}) => context.pass === 'picture' ? null : sounds(props, context).map(
    ({from, durationInFrames, ...audio}, i) => <Sequence key={i} from={from} durationInFrames={durationInFrames}><Audio {...audio}/></Sequence>),
};
`;

it('listed kit loops and shared-file aliases match the browser WAV byte for byte', {
  skip: process.env.REMOTION_E2E !== '1' && 'set REMOTION_E2E=1', timeout: 120_000,
}, async () => {
  // The real entry point bundles dist/, just like renderTimeline.
  const {stageAssets} = await import('../dist/assets.js');
  const {libraryEntry, readLibraryKits, resolveFromApplication} = await import('../dist/library-kits.js');
  const {mixSounds, placeSounds} = await import('../dist/sound-mix.js');
  const root = await mkdtemp(path.join(tmpdir(), 'composer-sound-kit-e2e-'));
  try {
    const file = path.join(root, 'tone.wav');
    const tone = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-ar', '48000', file], {encoding: 'utf8'});
    assert.equal(tone.status, 0, tone.stderr);
    const built = await buildLibraryKit(path.join(root, 'kit'), {source: SOUND_KIT});
    const library = await readLibraryKits([{name: 'listed-sounds', version: '1.0.0', file: built.file, hash: built.hash}]);
    const timeline = cacheTimeline();
    const asset = {path: 'tone.wav', hash: await sha256(file), kind: 'audio' as const};
    timeline.assets = {tone: asset, alias: {...asset}};
    const item = {id: 'kit', from: 7, duration: 60, kit: {name: 'listed-sounds', version: '1.0.0'},
      props: {src: {$asset: 'tone'}, alias: {$asset: 'alias'}}};
    timeline.tracks = [
      {id: 'stage', type: 'visual', items: [item]},
      {id: 'audio', type: 'audio', items: [{id: 'a', from: 10, duration: 50, asset: 'tone', trimStart: 3, gain: 0.2}]},
    ];
    const staging = await stageAssets(timeline, root);
    assert.ok(staging.ok);
    const {staged} = staging;
    try {
      const inputProps = {timeline, files: staged.files, assetFrames: {}, pass: 'sound'};
      const serveUrl = await bundle({entryPoint: await libraryEntry(library), publicDir: staged.publicDir,
        outDir: path.join(root, 'bundle'), webpackOverride: resolveFromApplication});
      const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps});
      const browser = path.join(root, 'browser.wav'), mixed = path.join(root, 'mixed.wav');
      await renderMedia({composition, serveUrl, inputProps, codec: 'wav', enforceAudioTrack: true,
        outputLocation: browser, sampleRate: 48000, concurrency: 2});
      const sounds = placeSounds({timeline, soundItems: [item], files: staged.files, sources: staged.sources,
        assetFrames: {}, kits: library.versions});
      assert.ok(sounds);
      await mixSounds({sounds, timeline, output: mixed, sampleRate: 48000});
      assert.equal(await sha256(mixed), await sha256(browser));
    } finally {
      await staged.cleanup();
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
