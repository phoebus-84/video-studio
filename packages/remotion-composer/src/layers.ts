import type {EditTimeline, Track, VisualItem} from './schema.js';
import type {KitVersion} from './kits/types.js';
import {isAudioItem} from './schema.js';

/**
 * Every visual item in drawing order: tracks by ascending z (ties in array
 * order, hidden tracks skipped), and within a track by start frame (ties in
 * array order). A crossfading item therefore always draws above the item it
 * fades over, however the track lists them.
 */
export function visualLayers(timeline: EditTimeline): {track: Track; item: VisualItem}[] {
  return timeline.tracks
    .map((track, index) => ({track, index}))
    .filter(({track}) => track.type === 'visual' && !track.hidden)
    .sort((a, b) => (a.track.z ?? 0) - (b.track.z ?? 0) || a.index - b.index)
    .flatMap(({track}) =>
      track.items
        .map((item, index) => ({item, index}))
        .filter((x): x is {item: VisualItem; index: number} => !isAudioItem(x.item))
        .sort((a, b) => a.item.from - b.item.from || a.index - b.index)
        .map(({item}) => ({track, item})),
    );
}

/**
 * The visual items whose kit plays sound (`sound: true`), in drawing order:
 * what the sound pass mounts beside the audio tracks. `kitOf` resolves a
 * name@version (application kits and the library kits of the render).
 */
export function soundLayers(timeline: EditTimeline, kitOf: (name: string, version: string) => Pick<KitVersion, 'sound'> | undefined): {track: Track; item: VisualItem}[] {
  return visualLayers(timeline).filter(({item}) => kitOf(item.kit.name, item.kit.version)?.sound === true);
}
