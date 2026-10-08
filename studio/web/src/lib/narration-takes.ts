// A spec-driven episode's narration takes, as the Narration tab plays them
// (avg-goz): what the gateway answers, and which word is being said.

import type { EpisodeRef } from "./sheet-review";

export interface TakeWord {
  text: string;
  start: number;
  end: number;
}

export interface TakeView {
  id: string;
  text: string;
  spokenText?: string;
  language?: string;
  role?: string;
  voice: { provider?: string; voiceId?: string; direction?: string; model?: string } | null;
  durationSeconds: number | null;
  audio: (EpisodeRef & { path: string }) | null;
  words: TakeWord[] | null;
}

export interface TakeUnit {
  id: string;
  sequence: { take: string; pauseBefore?: number }[];
}

export interface NarrationTakesAnswer {
  specDriven: boolean;
  units: TakeUnit[];
  takes: TakeView[];
  sources: { pin: string; episode: EpisodeRef; units: TakeUnit[]; takes: TakeView[] }[];
}

/** The index of the word being said at `t` seconds, or −1 before, between or after the words. */
export function wordAt(words: TakeWord[] | null, t: number): number {
  if (!words) return -1;
  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = words[mid]!;
    if (t < w.start) hi = mid - 1;
    else if (t >= w.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** The takes in the order their units say them, with the pause before each; takes no unit names come last. */
export function inOrder(units: TakeUnit[], takes: TakeView[]): { unit: string | null; take: TakeView; pauseBefore: number | null }[] {
  const byId = new Map(takes.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const rows: { unit: string | null; take: TakeView; pauseBefore: number | null }[] = [];
  for (const unit of units) {
    for (const entry of unit.sequence) {
      const take = byId.get(entry.take);
      if (!take) continue;
      seen.add(take.id);
      rows.push({ unit: unit.id, take, pauseBefore: entry.pauseBefore ?? null });
    }
  }
  for (const take of takes) if (!seen.has(take.id)) rows.push({ unit: null, take, pauseBefore: null });
  return rows;
}
