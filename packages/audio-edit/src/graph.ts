// A recipe as one ffmpeg filter graph: each clip trimmed, conformed, gained,
// automated, faded and delayed into place; each track summed (never
// normalized: a gain is what it says), gained and ducked; the tracks summed
// into the mix. Fades are quarter-sine, so a crossfade keeps the power
// constant across the join.

import type { Placement, Recipe } from "./types.js";

const n6 = (n: number) => (Math.round(n * 1e6) / 1e6).toString();

/** A dB curve as an ffmpeg expression of t: linear between points, held at the ends. */
export function curveExpression(points: [number, number][]): string {
  const [first, ...rest] = points;
  if (!first) return "0";
  let expr = n6(points[points.length - 1]![1]);
  for (let k = points.length - 1; k >= 1; k--) {
    const [t0, v0] = points[k - 1]!;
    const [t1, v1] = points[k]!;
    expr = `if(lt(t,${n6(t1)}),${n6(v0)}+(${n6(v1 - v0)})*(t-${n6(t0)})/${n6(t1 - t0)},${expr})`;
  }
  return rest.length === 0 ? n6(first[1]) : `if(lt(t,${n6(first[0])}),${n6(first[1])},${expr})`;
}

/** The duck as a dB expression of the output's t: down by `gain` while the other track plays, ramped. */
export function duckExpression(spans: [number, number][], gain: number, attack: number, release: number): string {
  // Spans closer than their ramps merge: the bed does not bob between two phrases.
  const merged: [number, number][] = [];
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] <= attack + release) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  if (merged.length === 0) return "0";
  const one = ([s, e]: [number, number]) => {
    const up = attack > 0 ? `clip((t-${n6(s - attack)})/${n6(attack)},0,1)` : `gte(t,${n6(s)})`;
    const down = release > 0 ? `clip((${n6(e + release)}-t)/${n6(release)},0,1)` : `lte(t,${n6(e)})`;
    return `min(${up},${down})`;
  };
  const amount = merged.map(one).reduce((acc, x) => `max(${acc},${x})`);
  return `${n6(gain)}*${amount}`;
}

export interface Graph {
  /** Input files, in -i order. */
  inputs: string[];
  filter: string;
  /** The label of the mix. */
  out: string;
  /** Where the mix ends. */
  duration: number;
}

export function buildGraph(recipe: Recipe, placements: Placement[], resolve: (source: string) => string): Graph {
  const sampleRate = recipe.output.sampleRate ?? 48000;
  const layout = (recipe.output.channels ?? 1) === 2 ? "stereo" : "mono";
  const inputs: string[] = [];
  const indexOf = (file: string) => {
    const at = inputs.indexOf(file);
    if (at >= 0) return at;
    inputs.push(file);
    return inputs.length - 1;
  };
  const chains: string[] = [];
  const clipLabels = new Map<string, string[]>();
  placements.forEach((p, k) => {
    const track = recipe.tracks.find((t) => t.id === p.track)!;
    const clip = track.clips.find((c) => c.id === p.clip)!;
    const span = p.end - p.start;
    const steps = [
      `atrim=start=${n6(p.in)}:end=${n6(p.out)}`, "asetpts=PTS-STARTPTS",
      `aresample=${sampleRate}`, `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout}`,
    ];
    if (clip.gain) steps.push(`volume=${n6(clip.gain)}dB`);
    // Evaluated every 64 samples: once per decoded frame (~90 ms) would move the gain in audible steps.
    if (clip.automation?.length) steps.push("asetnsamples=n=64:p=0", `volume='pow(10,(${curveExpression(clip.automation)})/20)':eval=frame`);
    if (p.fadeIn > 0) steps.push(`afade=t=in:st=0:d=${n6(p.fadeIn)}:curve=qsin`);
    if (p.fadeOut > 0) steps.push(`afade=t=out:st=${n6(span - p.fadeOut)}:d=${n6(p.fadeOut)}:curve=qsin`);
    // To the sample: a millisecond delay would leave gaps or overlaps of up to half a millisecond at every join.
    const offset = Math.round(p.start * sampleRate);
    if (offset > 0) steps.push(`adelay=delays=${offset}S:all=1`);
    const label = `c${k}`;
    chains.push(`[${indexOf(resolve(p.source))}:a]${steps.join(",")}[${label}]`);
    clipLabels.set(p.track, [...(clipLabels.get(p.track) ?? []), label]);
  });
  const trackLabels: string[] = [];
  recipe.tracks.forEach((track, t) => {
    const labels = clipLabels.get(track.id) ?? [];
    const steps: string[] = [];
    if (track.gain) steps.push(`volume=${n6(track.gain)}dB`);
    if (track.duck) {
      const spans = placements.filter((p) => p.track === track.duck!.under).map((p) => [p.start, p.end] as [number, number]);
      steps.push("asetnsamples=n=64:p=0", `volume='pow(10,(${duckExpression(spans, track.duck.gain, track.duck.attack ?? 0.25, track.duck.release ?? 0.6)})/20)':eval=frame`);
    }
    const sum = labels.length > 1 ? `amix=inputs=${labels.length}:normalize=0:dropout_transition=0` : "anull";
    chains.push(`${labels.map((l) => `[${l}]`).join("")}${[sum, ...steps].join(",")}[t${t}]`);
    trackLabels.push(`t${t}`);
  });
  const mix = trackLabels.length > 1
    ? `${trackLabels.map((l) => `[${l}]`).join("")}amix=inputs=${trackLabels.length}:normalize=0:dropout_transition=0[mix]`
    : `[${trackLabels[0]}]anull[mix]`;
  chains.push(mix);
  return { inputs, filter: chains.join(";"), out: "mix", duration: Math.max(...placements.map((p) => p.end)) };
}
