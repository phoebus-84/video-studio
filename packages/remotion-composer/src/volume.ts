// Per-frame audio volume (pure): gain × fade-in × fade-out × ducking.
//
// Ducking lowers a track to `duck.gain` while any item on its `under` tracks
// is sounding, ramping in over `attack` frames before that item starts and
// back out over `release` frames after it ends — a volume ramp, not a
// compressor, which is what voice over music needs.

import type {AudioItem, EditTimeline, Track} from './schema.js';
import {isAudioItem} from './schema.js';

const ramp = (x: number) => Math.max(0, Math.min(1, x));

/** How much of the ducking applies at a timeline frame: 0 none, 1 fully ducked. */
export function duckWeight(frame: number, sounding: {from: number; duration: number}[], attack: number, release: number): number {
  let weight = 0;
  for (const span of sounding) {
    const end = span.from + span.duration;
    let w = 0;
    if (frame >= span.from && frame < end) w = 1;
    else if (frame < span.from && frame >= span.from - attack) w = attack === 0 ? 0 : ramp((frame - (span.from - attack)) / attack);
    else if (frame >= end && frame < end + release) w = release === 0 ? 0 : ramp(1 - (frame - end) / release);
    weight = Math.max(weight, w);
  }
  return weight;
}

/**
 * The volume function of one audio item, taking the frame relative to the
 * item's start (as Remotion passes it) and returning a gain ≥ 0.
 */
export function itemVolume(item: AudioItem, track: Track, timeline: EditTimeline): (localFrame: number) => number {
  const gain = item.gain ?? 1;
  const fadeIn = Math.max(item.fadeIn ?? 0, item.transitionIn?.duration ?? 0);
  const fadeOut = Math.max(item.fadeOut ?? 0, item.transitionOut?.duration ?? 0);
  const under = track.duck
    ? timeline.tracks
        .filter((t) => track.duck!.under.includes(t.id) && t.type === 'audio' && !t.muted)
        .flatMap((t) => t.items.filter(isAudioItem).map((i) => ({from: i.from, duration: i.duration})))
    : [];
  return (localFrame: number) => {
    if (localFrame < 0 || localFrame >= item.duration) return 0;
    const inRamp = fadeIn > 0 ? ramp(localFrame / fadeIn) : 1;
    const outRamp = fadeOut > 0 ? ramp((item.duration - localFrame) / fadeOut) : 1;
    let duck = 1;
    if (track.duck) {
      const w = duckWeight(item.from + localFrame, under, track.duck.attack ?? 0, track.duck.release ?? 0);
      duck = 1 - (1 - track.duck.gain) * w;
    }
    return gain * inRamp * outRamp * duck;
  };
}
