// What an overlay kit drew, measured on its transparent render (avg-tk7.4):
// the box of every pixel with any opacity, read exactly from the alpha plane,
// and how far that box crosses the safe zone.

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import type {CatalogProfile} from './helpers.js';

export interface Box {left: number; top: number; right: number; bottom: number}

/** The inclusive box of every pixel whose alpha is above 0; null when nothing was drawn. */
export function drawnBox(file: string, width: number, height: number): Box | null {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'alphaextract', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {maxBuffer: width * height + 1024});
  assert.equal(r.status, 0, `alphaextract failed on ${file}: ${r.stderr?.toString().slice(-400)}`);
  const alpha = r.stdout;
  assert.equal(alpha.length, width * height, `${file} is not ${width}x${height}`);
  let box: Box | null = null;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] === 0) continue;
      if (!box) box = {left: x, top: y, right: x, bottom: y};
      else {
        if (x < box.left) box.left = x;
        if (x > box.right) box.right = x;
        box.bottom = y;
      }
    }
  }
  return box;
}

/** How far a drawn box crosses each edge of the safe zone, in pixels; empty when inside. */
export function overflow(box: Box, profile: Pick<CatalogProfile, 'width' | 'height' | 'safeZone'>): string[] {
  const {top, right, bottom, left} = profile.safeZone;
  const out: string[] = [];
  if (box.top < top) out.push(`${top - box.top} px above`);
  if (box.bottom > profile.height - 1 - bottom) out.push(`${box.bottom - (profile.height - 1 - bottom)} px below`);
  if (box.left < left) out.push(`${left - box.left} px left of`);
  if (box.right > profile.width - 1 - right) out.push(`${box.right - (profile.width - 1 - right)} px right of`);
  return out;
}
