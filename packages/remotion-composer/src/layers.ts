import type {EditTimeline, Track, VisualItem} from './schema.js';
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
