// renderLayoutSheet (avg-3th.1): a timeline's stills at the frames the caller
// picks, then one labelled grid of them — both rendered by Remotion, from one
// bundle, in one browser. Which frames, and where an episode keeps its sheet,
// are the studio's business, not this package's.

import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openBrowser, renderStill, selectComposition, type HeadlessBrowser} from '@remotion/renderer';
import {stageAssets, sha256} from './assets.js';
import {ComposerError} from './errors.js';
import {timelineKits, type LockedKit} from './kit-lock.js';
import {libraryEntry, readLibraryKits, type LibraryKit} from './library-kits.js';
import {bundleInto} from './bundle-cache.js';
import {sheetSize, type SheetProps} from './Sheet.js';
import {validateTimeline} from './validate.js';
import {videoFrames} from './probe.js';

/** The most stills one sheet holds. */
export const MAX_SHEET_PICKS = 120;

export interface LayoutSheetOptions {
  /** A studio.video/v1alpha2 EditTimeline that already passed validateEditTimeline. */
  timeline: unknown;
  /** The directory asset paths are relative to (the episode). */
  assetRoot: string;
  /** Folders outside assetRoot that assets may also come from (a channel's theme releases, ADR-0040). */
  sharedRoots?: string[];
  /** Distinct whole frames inside the timeline, in the order the sheet shows them. */
  picks: {frame: number; label: string}[];
  /** Created if missing; frames/NNN.jpg and sheet.jpg are written inside. */
  outDir: string;
  /** Of the timeline's resolution, in (0, 1]. Default 0.25. */
  scale?: number;
  /** Default 6 for a landscape timeline, 8 for portrait or square. */
  columns?: number;
  /** Stills rendered at once. Default 6. */
  parallel?: number;
  /** Kits the channel or the series carries (avg-d1x), beside the application's. */
  kits?: readonly LibraryKit[];
}

export interface LayoutSheetFrame {
  index: number;
  frame: number;
  seconds: number;
  label: string;
  /** Absolute. */
  path: string;
  hash: string;
}

export interface LayoutSheetResult {
  frames: LayoutSheetFrame[];
  sheet: {path: string; hash: string; columns: number; rows: number; width: number; height: number};
  /** Each kit the timeline draws with, and its code hash from kits.lock.json. */
  kits: LockedKit[];
}

/** mm:ss.ff — minutes, seconds and the frame within the second. */
export function sheetTime(frame: number, fps: number): string {
  const whole = Math.floor(frame / fps);
  const pad = (n: number) => String(n).padStart(2, '0');
  // Rounded: with a fractional rate (29.97) the frame within the second is not whole.
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}.${pad(Math.round(frame - whole * fps))}`;
}

function refuse(message: string): never {
  throw new ComposerError('bad-sheet', message);
}

export async function renderLayoutSheet(options: LayoutSheetOptions): Promise<LayoutSheetResult> {
  const library = await readLibraryKits(options.kits ?? []);
  const checked = validateTimeline(options.timeline, {kits: library.versions});
  if (!checked.ok) {
    const code = checked.problems[0]!.code;
    throw new ComposerError(code, `the timeline cannot be rendered: ${checked.problems.map((p) => `${p.code} at ${p.path}`).join('; ')}`, checked.problems);
  }
  const timeline = checked.timeline;
  const {picks} = options;
  const scale = options.scale ?? 0.25;
  const {width, height} = timeline.resolution;
  const columns = options.columns ?? (width > height ? 6 : 8);
  if (picks.length === 0) refuse('a sheet needs at least one frame');
  if (picks.length > MAX_SHEET_PICKS) refuse(`a sheet holds at most ${MAX_SHEET_PICKS} frames, not ${picks.length}`);
  const seen = new Set<number>();
  for (const {frame} of picks) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= timeline.durationInFrames) {
      refuse(`frame ${frame} is not a frame of this timeline (0–${timeline.durationInFrames - 1})`);
    }
    if (seen.has(frame)) refuse(`frame ${frame} is picked twice`);
    seen.add(frame);
  }
  if (!(scale > 0 && scale <= 1)) refuse(`scale ${scale} is not in (0, 1]`);
  if (!Number.isInteger(columns) || columns < 1) refuse(`columns ${columns} is not a positive whole number`);

  const kits = timelineKits(timeline, options.kits ?? []) ?? refuse('a kit of this timeline is neither in kits.lock.json nor a library kit it was handed');

  const staging = await stageAssets(timeline, options.assetRoot, options.sharedRoots);
  if (!staging.ok) {
    throw new ComposerError(staging.problems[0]!.code, `assets are not what the timeline says: ${staging.problems.map((p) => p.message).join('; ')}`, staging.problems);
  }
  const {staged} = staging;
  const outDir = path.resolve(options.outDir);
  let work: string | undefined;
  let browser: HeadlessBrowser | undefined;
  try {
    work = await mkdtemp(path.join(tmpdir(), 'remotion-composer-sheet-'));
    const assetFrames: Record<string, number> = {};
    for (const [id, asset] of Object.entries(timeline.assets)) {
      if (asset.kind === 'video') assetFrames[staged.files[id]!] = videoFrames(staged.sources[id]!, timeline.fps);
    }
    await mkdir(path.join(outDir, 'frames'), {recursive: true});
    const entryPoint = await libraryEntry(library);
    const frames: LayoutSheetFrame[] = picks.map((p, index) => ({
      index,
      frame: p.frame,
      seconds: Number((p.frame / timeline.fps).toFixed(3)),
      label: p.label,
      path: path.join(outDir, 'frames', `${String(index).padStart(3, '0')}.jpg`),
      hash: '',
    }));
    const sheetPath = path.join(outDir, 'sheet.jpg');
    let sheet: SheetProps;
    try {
      const serveUrl = await bundleInto({entryPoint, withKits: Boolean(options.kits?.length)}, staged.publicDir, path.join(work, 'bundle'));
      browser = await openBrowser('chrome');
      const inputProps = {timeline, files: staged.files, assetFrames};
      const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps, puppeteerInstance: browser});
      let next = 0;
      const worker = async () => {
        while (next < frames.length) {
          const f = frames[next++]!;
          await renderStill({composition, serveUrl, inputProps, output: f.path, frame: f.frame, scale, imageFormat: 'jpeg', jpegQuality: 80, puppeteerInstance: browser});
        }
      };
      await Promise.all(Array.from({length: Math.max(1, Math.min(options.parallel ?? 6, frames.length))}, worker));

      sheet = {
        columns,
        tileWidth: Math.round(width * scale),
        tileHeight: Math.round(height * scale),
        tiles: await Promise.all(frames.map(async (f) => ({
          src: `data:image/jpeg;base64,${(await readFile(f.path)).toString('base64')}`,
          caption: `#${String(f.index).padStart(2, '0')} · ${sheetTime(f.frame, timeline.fps)} · ${f.label}`,
        }))),
      };
      const grid = await selectComposition({serveUrl, id: 'Sheet', inputProps: sheet, puppeteerInstance: browser});
      await renderStill({composition: grid, serveUrl, inputProps: sheet, output: sheetPath, frame: 0, imageFormat: 'jpeg', jpegQuality: 85, puppeteerInstance: browser});
    } catch (e) {
      throw new ComposerError('sheet-failed', `Remotion could not render the layout sheet: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const f of frames) f.hash = await sha256(f.path);
    const size = sheetSize(sheet);
    return {
      frames,
      sheet: {path: sheetPath, hash: await sha256(sheetPath), columns, rows: Math.ceil(frames.length / columns), ...size},
      kits,
    };
  } finally {
    await browser?.close({silent: true}).catch(() => undefined);
    await staged.cleanup();
    if (work) await rm(work, {recursive: true, force: true});
  }
}
