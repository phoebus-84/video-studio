import type {EditTimeline} from '../src/schema.js';

export function cacheTimeline(): EditTimeline {
  return {
    apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline',
    episodeRef: {channel: 'c', series: 's', episode: 'e'}, revision: 1,
    fps: 30, durationInFrames: 75, resolution: {width: 320, height: 180},
    profile: {id: 'test', width: 320, height: 180, safeZone: {top: 8, right: 8, bottom: 8, left: 8}, loudness: {integrated: -15, truePeak: -1, range: 11}},
    assets: {
      a: {path: 'a.png', hash: `sha256:${'a'.repeat(64)}`, kind: 'image'},
      b: {path: 'b.png', hash: `sha256:${'b'.repeat(64)}`, kind: 'image'},
      voice: {path: 'voice.wav', hash: `sha256:${'c'.repeat(64)}`, kind: 'audio'},
    },
    tracks: [
      {id: 'main', type: 'visual', z: 0, items: [
        {id: 'a', from: 0, duration: 36, kit: {name: 'still', version: '1.0.0'}, props: {src: {$asset: 'a'}}},
        {id: 'b', from: 24, duration: 51, kit: {name: 'still', version: '1.0.0'}, props: {src: {$asset: 'b'}}, transitionIn: {type: 'crossfade', duration: 12}},
      ]},
      {id: 'captions', type: 'visual', z: 1, items: [{id: 'c', from: 40, duration: 10, kit: {name: 'captions', version: '1.1.0'}, props: {text: 'Hello'}}]},
      {id: 'voice', type: 'audio', items: [{id: 'v', from: 0, duration: 75, asset: 'voice'}]},
    ],
  };
}
