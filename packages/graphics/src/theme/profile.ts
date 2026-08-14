// ── Safe area profiles ──
// Profile-aware layout bounds. 16:9 is the primary target;
// additional profiles (4:3, 1:1, 9:16) are defined for future use.

import type { SafeAreaProfile } from './types.js';
import type { SafeArea } from '../models/request.js';

// ── Profile catalog ──

export const SAFE_AREA_PROFILES: Record<string, SafeAreaProfile> = {
  '16:9': {
    id: '16:9',
    label: 'Standard widescreen (16:9)',
    aspectRatio: 16 / 9,
    topFraction: 0.04,     // 4% safe inset
    rightFraction: 0.04,
    bottomFraction: 0.04,
    leftFraction: 0.04,
  },
  '4:3': {
    id: '4:3',
    label: 'Standard definition (4:3)',
    aspectRatio: 4 / 3,
    topFraction: 0.05,
    rightFraction: 0.05,
    bottomFraction: 0.05,
    leftFraction: 0.05,
  },
  '1:1': {
    id: '1:1',
    label: 'Square (1:1)',
    aspectRatio: 1,
    topFraction: 0.06,
    rightFraction: 0.06,
    bottomFraction: 0.06,
    leftFraction: 0.06,
  },
  '9:16': {
    id: '9:16',
    label: 'Vertical / Stories (9:16)',
    aspectRatio: 9 / 16,
    topFraction: 0.03,
    rightFraction: 0.05,
    bottomFraction: 0.03,
    leftFraction: 0.05,
  },
};

export const DEFAULT_SAFE_AREA_PROFILE: SafeAreaProfile = SAFE_AREA_PROFILES['16:9'];

// ── Helpers ──

/**
 * Resolve a safe area profile by ID.
 * Returns the profile or undefined if not found.
 */
export function resolveProfile(profileId?: string): SafeAreaProfile | undefined {
  if (profileId === undefined) return DEFAULT_SAFE_AREA_PROFILE;
  return SAFE_AREA_PROFILES[profileId];
}

/**
 * Compute pixel-safe-area from a profile and pixel dimensions.
 */
export function computePixelSafeArea(
  profile: SafeAreaProfile,
  width: number,
  height: number,
): SafeArea {
  return {
    top: Math.round(profile.topFraction * height),
    right: Math.round(profile.rightFraction * width),
    bottom: Math.round(profile.bottomFraction * height),
    left: Math.round(profile.leftFraction * width),
  };
}

/**
 * Determine the best-matching profile for the given pixel dimensions.
 * Returns the profile whose aspect ratio most closely matches.
 */
export function bestFitProfile(width: number, height: number): SafeAreaProfile {
  if (width <= 0 || height <= 0) return DEFAULT_SAFE_AREA_PROFILE;
  const targetRatio = width / height;
  let best: SafeAreaProfile = DEFAULT_SAFE_AREA_PROFILE;
  let bestDiff = Infinity;
  for (const profile of Object.values(SAFE_AREA_PROFILES)) {
    const diff = Math.abs(profile.aspectRatio - targetRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = profile;
    }
  }
  return best;
}
