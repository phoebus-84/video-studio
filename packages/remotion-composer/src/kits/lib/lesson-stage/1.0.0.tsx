// lesson-stage@1.0.0 — released: never edit this file; add lesson-stage/<next>.tsx instead (ADR-0039, ADR-0040).
// What the 16:9 lesson stage draws with, channel-neutral: every colour comes
// from the look's roles. Rewritten from CreativeStudio's poesie-museo-long
// runtime v10 (ui.tsx, fx7.tsx): the glass panel, the cover framing, the
// looping monitor clip, the distant storm in a sky polygon, the live bolt,
// the teleport column and the warp between rooms; SVG ids unique per
// instance, images and videos URLs their caller resolved.

import React, {useId} from 'react';
import {Freeze, Img, Loop, OffthreadVideo} from 'remotion';
import {clamp, ease, rnd} from '../stage-math/1.0.0.js';
import {alpha, type Look} from '../look/1.0.0.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Point = [number, number];

const sid = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

// --------------------------------------------------------------- lightning
export const boltPoints = (x0: number, y0: number, x1: number, y1: number, n: number, seed: number, jitter = 90): Point[] =>
  Array.from({length: n}, (_, i) => {
    const k = i / (n - 1);
    const j = i === 0 || i === n - 1 ? 0 : (rnd(seed + i * 3.1) - 0.5) * jitter * (1 - Math.abs(k - 0.5));
    return [x0 + (x1 - x0) * k + j, y0 + (y1 - y0) * k + (rnd(seed + i) - 0.5) * 12];
  });
export const ptsPath = (p: Point[]) => 'M' + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');

/** How bright the scene is under a lightning flash at t, from the strike instants. */
export const strikeAt = (t: number, strikes: readonly number[]): number =>
  strikes.reduce((m, a) => {
    const d = t - a;
    return d < 0 || d > 0.7 ? m : Math.max(m, d < 0.06 ? 1 : d < 0.12 ? 0.35 : d < 0.2 ? 0.85 : Math.exp(-(d - 0.2) * 6) * 0.6);
  }, 0);

/** A live bolt, redrawn every few frames, branching, glowing in the look's lightning; `grow` 0 → 1 draws it down. */
export const LiveBolt: React.FC<{look: Look; t: number; x0: number; y0: number; x1: number; y1: number; op: number; seed?: number; grow?: number}> = ({look, t, x0, y0, x1, y1, op, seed = 1, grow = 1}) => {
  const id = sid(useId());
  if (op <= 0) return null;
  const s = Math.floor(t * 10) + seed;
  const pts = boltPoints(x0, y0, x1, y1, 12, s, 70);
  const n = Math.max(2, Math.round(pts.length * clamp(grow)));
  const fl = 0.55 + 0.45 * rnd(Math.floor(t * 30) + seed);
  const br = [3, 6, 9].filter((i) => i < n - 1).map((i) => boltPoints(pts[i]![0], pts[i]![1], pts[i]![0] + (rnd(s + i) - 0.5) * 260, pts[i]![1] + 90 + rnd(s + i + 1) * 120, 5, s + i, 30));
  return (
    <g opacity={op * fl}>
      <defs><filter id={`${id}b`}><feGaussianBlur stdDeviation="8" /></filter></defs>
      <path d={ptsPath(pts.slice(0, n))} stroke={look.colors.lightning} strokeWidth={16} fill="none" opacity={0.35} filter={`url(#${id}b)`} />
      <path d={ptsPath(pts.slice(0, n))} stroke="#ffffff" strokeWidth={4} fill="none" />
      {br.map((b, j) => <path key={j} d={ptsPath(b)} stroke={look.colors.lightning} strokeWidth={2} fill="none" opacity={0.8} />)}
    </g>
  );
};

/** Where a vertical line at x crosses a polygon: its top and bottom, or null outside. */
export const polygonSpan = (poly: readonly Point[], x: number): [number, number] | null => {
  const ys: number[] = [];
  poly.forEach(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length]!;
    if ((x >= Math.min(ax, bx) && x <= Math.max(ax, bx)) && ax !== bx) ys.push(ay + ((x - ax) / (bx - ax)) * (by - ay));
  });
  return ys.length < 2 ? null : [Math.min(...ys), Math.max(...ys)];
};

export interface Sky {
  poly: Point[];
  period?: number;
  seed?: number;
  scale?: number;
}

/**
 * A distant storm in a sky polygon: thin, slow bolts from its top edge towards
 * its horizon, not every period (some are skipped), a soft glow where they
 * start. `calm` 0 hides it (the loop's first and last frames).
 */
export const DistantStorm: React.FC<{look: Look; t: number; sky: Sky; calm?: number}> = ({look, t, sky, calm = 1}) => {
  const id = sid(useId());
  if (calm <= 0.01) return null;
  const period = sky.period ?? 7;
  const seed = sky.seed ?? 1;
  const scale = sky.scale ?? 1;
  const xs = sky.poly.map(([x]) => x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const x0 = minX + (maxX - minX) * 0.06;
  const x1 = maxX - (maxX - minX) * 0.06;
  const k0 = Math.floor(t / period);
  const items = [k0 - 1, k0].flatMap((k) => {
    if (k < 0 || rnd(seed * 31 + k * 7.3) < 0.3) return [];
    const at = k * period + rnd(seed * 13 + k) * period * 0.7;
    const dt = t - at;
    if (dt < 0 || dt > 1.6) return [];
    const x = x0 + rnd(seed * 5 + k * 3.1) * (x1 - x0);
    const span = polygonSpan(sky.poly, x);
    if (!span) return [];
    const top = span[0] + 30 * scale;
    const horizon = span[1] - 4;
    const y0 = top + (horizon - top) * (0.05 + 0.25 * rnd(seed + k * 2.2));
    const grow = ease(dt / 0.45);
    const op = clamp(0.55 + 0.45 * Math.sin(dt * 9)) * (1 - clamp((dt - 0.7) / 0.9));
    return [{k, x, y0, y1: horizon, grow, op, glow: Math.exp(-((dt - 0.25) ** 2) / 0.08)}];
  });
  return (
    <g opacity={calm}>
      <defs>
        <clipPath id={`${id}c`}><polygon points={sky.poly.map((p) => p.join(',')).join(' ')} /></clipPath>
        <filter id={`${id}b`}><feGaussianBlur stdDeviation={6 * scale} /></filter>
        <radialGradient id={`${id}g`}><stop offset="0" stopColor={look.colors.lightning} stopOpacity=".55" /><stop offset="1" stopColor={look.colors.lightning} stopOpacity="0" /></radialGradient>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        {items.map(({k, x, y0, y1, grow, op, glow}) => {
          const xe = x + (rnd(k + seed) - 0.5) * 40;
          const pts = Array.from({length: 9}, (_, i): Point => [x + (xe - x) * (i / 8) + (i && i < 8 ? (rnd(seed * 17 + k + i * 1.7) - 0.5) * 34 : 0), y0 + (y1 - y0) * (i / 8)]);
          const len = Math.hypot(xe - x, y1 - y0) * 1.5;
          const b = pts[3 + Math.floor(rnd(seed * 17 + k + 9) * 3)]!;
          const dir = rnd(seed * 17 + k + 4) > 0.5 ? 1 : -1;
          const branch = `M${b[0].toFixed(1)} ${b[1].toFixed(1)} L${(b[0] + dir * 22).toFixed(1)} ${(b[1] + (y1 - y0) * 0.16).toFixed(1)} L${(b[0] + dir * 30).toFixed(1)} ${(b[1] + (y1 - y0) * 0.3).toFixed(1)}`;
          return (
            <g key={k}>
              <ellipse cx={x} cy={y0 + 20} rx={90 * scale} ry={60 * scale} fill={`url(#${id}g)`} opacity={glow * 0.8} />
              <path d={ptsPath(pts)} stroke={look.colors.lightning} strokeWidth={5 * scale} fill="none" opacity={op * 0.6} filter={`url(#${id}b)`} strokeDasharray={len} strokeDashoffset={len * (1 - grow)} />
              <path d={ptsPath(pts)} stroke="#ffffff" strokeWidth={1.6 * scale} fill="none" opacity={op * 0.85} strokeDasharray={len} strokeDashoffset={len * (1 - grow)} strokeLinejoin="round" />
              <path d={branch} stroke="#ffffff" strokeWidth={1.1 * scale} fill="none" opacity={op * 0.6 * clamp((grow - 0.5) * 2)} />
            </g>
          );
        })}
      </g>
    </g>
  );
};

// --------------------------------------------------------------- pictures
/**
 * An image of any shape covering a box: its point (cx, cy) kept in view,
 * zoomed about that point. The browser fits it (object-fit: cover), so no
 * aspect ratio is assumed.
 */
export const Cover: React.FC<{src: string; box: Box; cx?: number; cy?: number; zoom?: number; filter?: string}> = ({src, box, cx = 0.5, cy = 0.5, zoom = 1, filter}) => (
  <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden'}}>
    <Img src={src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${cx * 100}% ${cy * 100}%`, transform: `scale(${zoom})`, transformOrigin: `${cx * 100}% ${cy * 100}%`, filter}} />
  </div>
);

/**
 * A video in a box that shows its own first frame, frozen, where `live` is 0
 * (the loop's first and last frames); given its length in frames, it starts
 * over when it ends instead of holding its last frame.
 */
export const LoopClip: React.FC<{src: string; box: Box; live: number; frames?: number; filter?: string}> = ({src, box, live, frames, filter}) => {
  const video = <OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: 'cover', filter}} />;
  return (
    <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden'}}>
      <Freeze frame={0}>{video}</Freeze>
      {live > 0 && <div style={{position: 'absolute', inset: 0, opacity: live}}>{frames && frames > 0 ? <Loop durationInFrames={frames}>{video}</Loop> : video}</div>}
    </div>
  );
};

// --------------------------------------------------------------- glass panel
/**
 * A glass panel: blurred behind, a thin edge, a line of light on top, its
 * reflection on the floor; `on` 0 → 1 materialises it with a scan line,
 * `spin` turns it on itself (degrees), `flash` lights its edge.
 */
export const Glass: React.FC<{look: Look; box: Box; t: number; on?: number; tilt?: number; spin?: number; flash?: number; children?: React.ReactNode}> = ({look, box, t, on = 1, tilt = -5, spin = 0, flash = 0, children}) => {
  if (on <= 0.001) return null;
  const k = ease(on);
  const sy = 0.04 + 0.96 * ease((on - 0.1) / 0.9);
  const a = look.colors.accent;
  return (
    <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, perspective: 2200, opacity: Math.min(1, on * 2.2)}}>
      <div style={{position: 'absolute', inset: 0, transform: `rotateY(${tilt + spin}deg) scaleY(${sy}) translateY(${Math.sin(t * 0.6) * 3}px)`, transformOrigin: '50% 50%', WebkitBoxReflect: 'below 26px linear-gradient(transparent 62%, rgba(255,255,255,.16))'} as React.CSSProperties}>
        <div style={{position: 'absolute', inset: 0, borderRadius: look.measures.plateRadius + 2, background: alpha(look.colors.plate, 0.5), backdropFilter: 'blur(14px) saturate(1.25)', border: `1px solid ${look.colors.plateLine}`, boxShadow: `0 0 0 1px ${alpha(a, 0.18 + 0.3 * flash)}, 0 40px 90px ${look.colors.shadow}, inset 0 1px 0 rgba(255,255,255,.7), 0 0 ${40 + 80 * flash}px ${alpha(a, 0.12 + 0.35 * flash)}`, overflow: 'hidden'}}>
          <div style={{position: 'absolute', inset: 10, borderRadius: 8, overflow: 'hidden'}}>{children}</div>
          <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 70%, rgba(255,255,255,.08) 100%)', pointerEvents: 'none'}} />
          <div style={{position: 'absolute', left: 24, right: 24, top: 0, height: 2, background: a, opacity: 0.9, boxShadow: `0 0 18px ${a}`}} />
          {on < 1 && <div style={{position: 'absolute', left: 0, right: 0, top: `${k * 100}%`, height: 3, background: '#fff', boxShadow: `0 0 30px ${a}`}} />}
        </div>
      </div>
    </div>
  );
};

// --------------------------------------------------------------- teleport
/**
 * A column of light, rings on the floor, the figure breaking into slices
 * and sparks rising: k = 0 the whole figure, 1 gone (an entrance runs k from
 * 1 to 0). `floorY` is where it stands, `h` its height in px.
 */
export const Teleport: React.FC<{look: Look; t: number; k: number; x: number; h: number; w?: number; floorY: number; children: React.ReactNode}> = ({look, t, k, x, h, w = 240, floorY, children}) => {
  const id = sid(useId());
  const a = look.colors.accent;
  const peak = Math.sin(Math.PI * clamp(k));
  const top = floorY - h - 40;
  const N = 34;
  const sh = (h + 60) / N;
  const f = Math.floor(t * 30);
  return (
    <g>
      <defs>
        <linearGradient id={`${id}beam`} x1="0" x2="1"><stop offset="0" stopColor={a} stopOpacity="0" /><stop offset=".35" stopColor={a} stopOpacity=".35" /><stop offset=".5" stopColor="#ffffff" stopOpacity=".85" /><stop offset=".65" stopColor={a} stopOpacity=".35" /><stop offset="1" stopColor={a} stopOpacity="0" /></linearGradient>
        <filter id={`${id}cy`} x="-30%" y="-10%" width="160%" height="120%"><feFlood floodColor={look.colors.glow} /><feComposite in2="SourceAlpha" operator="in" result="s" /><feGaussianBlur in="s" stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="s" /></feMerge></filter>
        <mask id={`${id}m`}>
          {Array.from({length: N}, (_, j) => {
            const v = clamp((1 - k) * 1.7 - (j / N) * 0.4 - rnd(j * 7.3) * 0.3);
            return <rect key={j} x={x - w} y={top + j * sh} width={2 * w} height={sh * v + 0.6} fill="#fff" />;
          })}
        </mask>
      </defs>
      <rect x={x - w * 0.62} y={0} width={w * 1.24} height={floorY + 10} fill={`url(#${id}beam)`} opacity={peak * 0.95} />
      <rect x={x - 3} y={0} width={6} height={floorY} fill="#fff" opacity={peak * 0.9} />
      {[0, 1, 2].map((j) => {
        const ph = (t * 1.4 + j / 3) % 1;
        return <ellipse key={j} cx={x} cy={floorY - ph * (h + 30)} rx={w * (0.55 + 0.15 * Math.sin(ph * Math.PI))} ry={22} fill="none" stroke={a} strokeWidth={3} opacity={peak * (1 - ph) * 0.9} />;
      })}
      <ellipse cx={x} cy={floorY} rx={w * 0.7} ry={30} fill={a} opacity={peak * 0.35} />
      <ellipse cx={x} cy={floorY} rx={w * (0.5 + 0.4 * peak)} ry={26} fill="none" stroke="#fff" strokeWidth={4} opacity={peak} />
      <g mask={`url(#${id}m)`}>
        <g opacity={1 - 0.35 * peak}>{children}</g>
        <g filter={`url(#${id}cy)`} opacity={peak * 0.75} transform={`translate(${(rnd(f) - 0.5) * 26 * peak} 0)`}>{children}</g>
      </g>
      {Array.from({length: 46}, (_, j) => {
        const sp = 0.35 + rnd(j + 3) * 0.6;
        const yy = floorY - ((t * sp + rnd(j)) % 1) * (h + 120);
        const xx = x + (rnd(j + 11) - 0.5) * w * 1.3;
        return <circle key={j} cx={xx} cy={yy} r={1.6 + rnd(j + 5) * 3} fill={j % 3 ? look.colors.glow : a} opacity={peak * (0.4 + 0.6 * rnd(j + (f % 7)))} />;
      })}
    </g>
  );
};

// --------------------------------------------------------------- warp
/** The passage between rooms: a white flash in the look's glow with radial streaks; k 0 → 1 → 0, the room changes at the peak. */
export const WarpLayer: React.FC<{look: Look; k: number}> = ({look, k}) => {
  const id = sid(useId());
  if (k <= 0) return null;
  return (
    <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
      <defs><radialGradient id={`${id}g`}><stop offset="0" stopColor="#ffffff" stopOpacity="1" /><stop offset=".45" stopColor={look.colors.glow} stopOpacity=".85" /><stop offset="1" stopColor={look.colors.lightning} stopOpacity=".55" /></radialGradient></defs>
      <rect width="1920" height="1080" fill={`url(#${id}g)`} opacity={Math.pow(k, 1.6)} />
      {Array.from({length: 70}, (_, j) => {
        const a = rnd(j) * Math.PI * 2;
        const r0 = 120 + rnd(j + 3) * 300;
        const r1 = r0 + (200 + rnd(j + 7) * 900) * k;
        return <line key={j} x1={960 + Math.cos(a) * r0} y1={540 + Math.sin(a) * r0} x2={960 + Math.cos(a) * r1} y2={540 + Math.sin(a) * r1} stroke={j % 4 ? '#ffffff' : look.colors.accent} strokeWidth={1.5 + rnd(j + 2) * 3} opacity={0.8 * k} />;
      })}
    </svg>
  );
};
