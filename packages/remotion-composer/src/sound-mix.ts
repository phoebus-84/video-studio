// The soundtrack mixed by FFmpeg, without a browser.
//
// The browser's sound pass mounts every <Audio> of the timeline only for
// Remotion to note, frame by frame, which file plays where and how loud; the
// mix itself was always FFmpeg's. Here those notes are written in Node — the
// audio tracks as Timeline mounts them, and the sounds a kit lists
// (KitVersion.sounds) — by Remotion's own rules for <Sequence>, trimBefore
// and loop, and handed to Remotion's stitcher, which mixes them as it does
// after a browser pass. A kit that lists no sound keeps the browser pass.

import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {RenderInternals, stitchFramesToVideo, type StitchFramesToVideoOptions} from '@remotion/renderer';
import {staticFile} from 'remotion';
import {resolveKit} from './kits/index.js';
import type {KitProfile, KitVersion} from './kits/types.js';
import type {AudioItem, EditTimeline, VisualItem} from './schema.js';
import {isAudioItem} from './schema.js';
import {resolveAssets} from './Timeline.js';
import {itemVolume} from './volume.js';

type Volume = number | ((frame: number) => number);

/** One <Audio> as the render would mount it: the file, the <Sequence>s around it, outermost first, and its own props. */
export interface PlacedSound {
  file: string;
  sequences: {from: number; durationInFrames: number}[];
  trimBefore?: number;
  loop?: boolean;
  volume?: Volume;
}

/** A frame's audio asset, as Remotion's <Audio> registers it while rendering. */
export interface SoundAsset {
  type: 'audio';
  src: string;
  id: string;
  frame: number;
  volume: number;
  mediaFrame: number;
  playbackRate: number;
  toneFrequency: number;
  audioStartFrame: number;
  audioStreamIndex: number;
}

interface Context {
  cumulatedFrom: number;
  relativeFrom: number;
  /** Remotion's actualDurationInFrames, which the asset id carries. */
  duration: number;
  firstFrame: number;
  cumulatedNegativeFrom: number;
  /** The `from` and `durationInFrames` props, which decide when the children show. */
  from: number;
  durationProp: number;
}

/** The SequenceContext a <Sequence from durationInFrames> gives its children (remotion/Sequence.js). */
function sequence(parent: Context | null, from: number, durationInFrames: number, total: number): Context {
  const cumulatedFrom = parent ? parent.cumulatedFrom + parent.relativeFrom : 0;
  const parentDuration = parent ? Math.min(parent.duration - from, durationInFrames) : durationInFrames;
  const start = cumulatedFrom + from;
  const firstFrame = Math.max(0, parent ? parent.firstFrame : 0, start);
  return {
    cumulatedFrom, relativeFrom: from, duration: Math.max(0, Math.min(total - from, parentDuration)),
    firstFrame, cumulatedNegativeFrom: start - firstFrame, from, durationProp: durationInFrames,
  };
}

/** Whether a sequence shows its children at a timeline frame (floats end on the ceiling, as Remotion does). */
const shows = (c: Context, frame: number) =>
  frame >= c.cumulatedFrom + c.from && frame <= Math.ceil(c.cumulatedFrom + c.from + c.durationProp - 1);

/**
 * Every frame's audio assets, as the browser would report them: `frames[f]`
 * lists what sounds at timeline frame f. `mediaSeconds` is a file's length
 * (a looping sound restarts after it).
 */
export function soundFrames(sounds: readonly PlacedSound[], total: number, fps: number, mediaSeconds: (file: string) => number): SoundAsset[][] {
  const frames: SoundAsset[][] = Array.from({length: total}, () => []);
  const seen: Set<string>[] = Array.from({length: total}, () => new Set());
  for (const sound of sounds) {
    const levels: Context[] = [];
    for (const s of sound.sequences) levels.push(sequence(levels.at(-1) ?? null, s.from, s.durationInFrames, total));
    const last = levels.at(-1);
    if (!last) throw new Error(`the sound ${sound.file} sits in no sequence`);
    const begin = Math.max(0, Math.ceil(last.cumulatedFrom + last.from));
    const end = Math.min(total - 1, Math.ceil(last.cumulatedFrom + last.from + last.durationProp - 1));
    // <Html5Audio loop> wraps itself in a <Loop> of the file's length; trimBefore in a <Sequence from={-trimBefore}>.
    const loopLength = sound.loop ? Number((mediaSeconds(sound.file) * fps - (sound.trimBefore ?? 0)).toFixed(10)) : 0;
    for (let frame = begin; frame <= end; frame++) {
      if (!levels.every((c) => shows(c, frame))) continue;
      let inner: Context = last;
      if (sound.loop) {
        const current = frame - (inner.cumulatedFrom + inner.relativeFrom);
        const maxFrame = loopLength * (Math.ceil(total / loopLength) - 1);
        const loop = sequence(inner, Math.min(Math.floor(current / loopLength) * loopLength, maxFrame), loopLength, total);
        if (!shows(loop, frame)) continue;
        inner = loop;
      }
      if (sound.trimBefore !== undefined) inner = sequence(inner, -sound.trimBefore, Infinity, total);
      const mediaFrame = frame - (inner.cumulatedFrom + inner.relativeFrom);
      // remotion/volume-prop.js, with the frame useFrameForVolumeProp gives ('repeat' in a loop).
      const v = sound.volume;
      const volume = v === undefined ? 1 : typeof v === 'number' ? v : Math.max(0, v(mediaFrame + inner.cumulatedNegativeFrom));
      if (!Number.isFinite(volume)) throw new Error(`the sound ${sound.file} has volume ${volume} at frame ${frame}`);
      // A silent frame registers nothing (AudioForRendering).
      if (volume <= 0) continue;
      const id = `audio-${sound.file}-${inner.relativeFrom}-${inner.cumulatedFrom}-${inner.duration}`;
      // Assets are deduplicated by id within a frame: the first one mounted wins.
      if (seen[frame]!.has(id)) continue;
      seen[frame]!.add(id);
      frames[frame]!.push({
        type: 'audio', src: sound.file, id, frame, volume, mediaFrame, playbackRate: 1, toneFrequency: 1,
        audioStartFrame: Math.max(0, -inner.cumulatedNegativeFrom), audioStreamIndex: 0,
      });
    }
  }
  return frames;
}

/** A staticFile() URL back to the staged file's name. */
const stagedName = (url: string) => decodeURIComponent(url.replace(/^\/+/, ''));

/**
 * Everything the sound pass would mount, or null when a kit that plays
 * sound cannot list it (the browser pass then stays). `files`: asset id →
 * staged file name; `sources`: asset id → the file on disk.
 */
export function placeSounds(options: {
  timeline: EditTimeline;
  soundItems: readonly VisualItem[];
  files: Record<string, string>;
  sources: Record<string, string>;
  assetFrames: Record<string, number>;
  kits?: readonly KitVersion[];
}): PlacedSound[] | null {
  const {timeline, files, sources} = options;
  const onDisk = new Map(Object.entries(files).map(([id, name]) => [name, sources[id]!]));
  const fileOf = (name: string) => {
    const file = onDisk.get(name);
    if (!file) throw new Error(`a sound plays ${name}, which no asset of the timeline stages`);
    return file;
  };
  const placed: PlacedSound[] = [];
  // Timeline.tsx: the visual layers (with the kits that play sound) first, then the audio tracks.
  const byUrl = Object.fromEntries(Object.entries(options.assetFrames).map(([file, frames]) => [staticFile(file), frames]));
  for (const item of options.soundItems) {
    const kit = resolveKit(item.kit.name, item.kit.version, options.kits);
    const listed = kit?.sounds?.(resolveAssets(item.props, files) as Record<string, unknown>, {assetFrames: byUrl, profile: timeline.profile as KitProfile, pass: 'sound'});
    if (!listed) return null;
    for (const sound of listed) {
      placed.push({
        file: fileOf(stagedName(sound.src)),
        sequences: [{from: item.from, durationInFrames: item.duration}, {from: sound.from, durationInFrames: sound.durationInFrames}],
        trimBefore: sound.trimBefore, loop: sound.loop, volume: sound.volume,
      });
    }
  }
  for (const track of timeline.tracks) {
    if (track.type !== 'audio' || track.muted) continue;
    for (const item of track.items.filter(isAudioItem) as AudioItem[]) {
      placed.push({
        file: fileOf(files[item.asset] ?? item.asset),
        sequences: [{from: item.from, durationInFrames: item.duration}],
        // startFrom (always passed by Timeline) is trimBefore.
        trimBefore: item.trimStart ?? 0, volume: itemVolume(item, track, timeline),
      });
    }
  }
  return placed;
}

/** A file's length in seconds, from ffprobe, as a looping <Audio> needs it. */
function probeSeconds(file: string): number {
  const out = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {encoding: 'utf8'});
  const seconds = Number(out.stdout?.trim());
  if (out.status !== 0 || !Number.isFinite(seconds) || seconds <= 0) throw new Error(`cannot read how long ${file} lasts, to loop it`);
  return seconds;
}

/** Mixes the sounds into a WAV with Remotion's own audio pipeline, as a browser pass would. */
export async function mixSounds(options: {
  sounds: readonly PlacedSound[];
  timeline: EditTimeline;
  output: string;
  sampleRate: number;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  const {timeline, sampleRate} = options;
  const total = timeline.durationInFrames;
  const lengths = new Map<string, number>();
  const seconds = (file: string) => lengths.get(file) ?? lengths.set(file, probeSeconds(file)).get(file)!;
  const frames = soundFrames(options.sounds, total, timeline.fps, seconds);
  const downloadMap = RenderInternals.makeDownloadMap(sampleRate);
  try {
    // Remotion fetches each asset's URL into its download directory; these
    // are local files, so each URL is recorded as downloaded already, to the
    // file itself.
    const urls = new Map<string, string>();
    for (const file of new Set(frames.flat().map((a) => a.src))) {
      const url = `http://sound-mix.invalid/${urls.size}/${encodeURIComponent(path.basename(file))}`;
      urls.set(file, url);
      downloadMap.hasBeenDownloadedMap[url] = {[downloadMap.downloadDir]: file};
    }
    const assets = frames.map((list, frame) => ({
      frame, artifactAssets: [], inlineAudioAssets: [],
      audioAndVideoAssets: list.map((a) => ({...a, src: urls.get(a.src)!})),
    }));
    await stitchFramesToVideo({
      fps: timeline.fps, width: timeline.resolution.width, height: timeline.resolution.height,
      assetsInfo: {
        assets: assets as unknown as StitchFramesToVideoOptions['assetsInfo']['assets'],
        imageSequenceName: '', firstFrameIndex: 0, downloadMap,
        chunkLengthInSeconds: total / timeline.fps, trimLeftOffset: 0, trimRightOffset: 0, forSeamlessAacConcatenation: false,
      },
      codec: 'wav', enforceAudioTrack: true, outputLocation: options.output, force: true, sampleRate,
    });
    options.onProgress?.(1);
  } finally {
    downloadMap.cleanupController.abort();
    downloadMap.inlineAudioMixing.cleanup();
    RenderInternals.deleteDirectory(downloadMap.assetDir);
  }
}
