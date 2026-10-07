// hall-fx@1.0.0 — released: never edit this file; add hall-fx/<next>.tsx instead (ADR-0039).
// What happens in a museum hall: the glass screen, the shards of a picture
// that shatters, lightning, the teleport column, and the named effects that
// live in a picture and come out of it into the hall. Rewritten from
// CreativeStudio's poesie-museo runtime (fx.tsx, v10/ui.tsx, v10/fx7.tsx):
// same drawing, with every SVG id made unique per instance and every image a
// URL its caller resolved (textures and silhouettes are assets, never paths).

import React, {useId} from 'react';
import {Img} from 'remotion';
import {clamp, ease as easeStage, rnd, smoothstep} from '../stage-math/1.0.0.js';
import {LIGHT} from '../dentro-i-versi/1.0.0.js';

/** CreativeStudio's effects use the gentler easing (smoothstep) and their own ramp(t, a, b). */
const ease = smoothstep;
const ramp = (t: number, a: number, b: number) => ease((t - a) / (b - a));
const sid = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// --------------------------------------------------------------- glass screen
/** A glass panel: blurred behind, a thin edge, a line of light, its reflection on the floor. */
export const Glass: React.FC<{box: Box; t: number; flash?: number; tilt?: number; children?: React.ReactNode}> = ({box, t, flash = 0, tilt = 0, children}) => (
  <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, perspective: 2200}}>
    <div style={{position: 'absolute', inset: 0, transform: `rotateY(${tilt}deg) translateY(${Math.sin(t * 0.6) * 3}px)`, transformOrigin: '50% 50%', WebkitBoxReflect: 'below 26px linear-gradient(transparent 62%, rgba(255,255,255,.16))'} as React.CSSProperties}>
      <div style={{position: 'absolute', inset: 0, borderRadius: 14, background: 'rgba(10,16,48,.42)', backdropFilter: 'blur(14px) saturate(1.25)', border: `1px solid ${LIGHT.line}`, boxShadow: `0 0 0 1px rgba(95,220,255,${0.18 + 0.3 * flash}), 0 40px 90px rgba(18,24,70,.32), inset 0 1px 0 rgba(255,255,255,.7), 0 0 ${40 + 80 * flash}px rgba(95,220,255,${0.12 + 0.35 * flash})`, overflow: 'hidden'}}>
        <div style={{position: 'absolute', inset: 10, borderRadius: 8, overflow: 'hidden'}}>{children}</div>
        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0) 70%, rgba(255,255,255,.08) 100%)', pointerEvents: 'none'}} />
        <div style={{position: 'absolute', left: 24, right: 24, top: 0, height: 2, background: LIGHT.cyan, opacity: 0.9, boxShadow: `0 0 18px ${LIGHT.cyan}`}} />
      </div>
    </div>
  </div>
);

/** An image covering a box, centred on (cx, cy) of the image. */
export const Cover: React.FC<{src: string; box: Box; cx?: number; cy?: number; zoom?: number; ratio?: number}> = ({src, box, cx = 0.5, cy = 0.5, zoom = 1, ratio = 0.75}) => {
  const w0 = Math.max(box.w, box.h * ratio);
  const w = w0 * zoom;
  const h = w / ratio;
  const left = clamp(box.w / 2 - cx * w, box.w - w, 0);
  const top = clamp(box.h / 2 - cy * h, box.h - h, 0);
  return (
    <div style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden'}}>
      <Img src={src} style={{position: 'absolute', left, top, width: w, height: h}} />
    </div>
  );
};

const SHARDS = (() => {
  const cols = 5;
  const rows = 3;
  const pts: [number, number][][] = [];
  const P = (i: number, j: number): [number, number] => {
    const edgeX = i === 0 || i === cols;
    const edgeY = j === 0 || j === rows;
    return [i / cols + (edgeX ? 0 : (rnd(i * 7 + j * 13) - 0.5) * 0.12), j / rows + (edgeY ? 0 : (rnd(i * 5 + j * 11 + 3) - 0.5) * 0.18)];
  };
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if ((i + j) % 2) pts.push([a, b, c], [a, c, d]);
      else pts.push([a, b, d], [b, c, d]);
    }
  }
  return pts;
})();

/** The picture breaks into triangles that fly into the hall (k 0 → 1). */
export const Shatter: React.FC<{src: string; box: Box; k: number}> = ({src, box, k}) => (
  <>
    {SHARDS.map((tri, i) => {
      const mx = tri.reduce((s, p) => s + p[0], 0) / 3;
      const my = tri.reduce((s, p) => s + p[1], 0) / 3;
      const dirX = (mx - 0.5) * 2 + (rnd(i + 40) - 0.5) * 0.8;
      const dirY = (my - 0.5) * 1.4 - 0.6 + (rnd(i + 50) - 0.5) * 0.5;
      const tx = dirX * 900 * k;
      const ty = dirY * 500 * k + 1500 * k * k;
      const rot = (rnd(i + 60) - 0.5) * 260 * k;
      return (
        <div key={i} style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, clipPath: `polygon(${tri.map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(',')})`, transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${1 - 0.25 * k})`, transformOrigin: `${mx * 100}% ${my * 100}%`, opacity: 1 - clamp((k - 0.7) / 0.3), filter: `drop-shadow(0 0 6px rgba(190,240,255,${0.6 * Math.min(1, k * 4)}))`}}>
          <Cover src={src} box={{x: 0, y: 0, w: box.w, h: box.h}} />
          <div style={{position: 'absolute', inset: 0, background: `linear-gradient(${rnd(i) * 360}deg, rgba(255,255,255,${0.25 * Math.min(1, k * 5)}), rgba(255,255,255,0) 50%)`}} />
        </div>
      );
    })}
  </>
);

// --------------------------------------------------------------- lightning
export const boltPoints = (x0: number, y0: number, x1: number, y1: number, n: number, seed: number, jitter = 90): [number, number][] =>
  Array.from({length: n}, (_, i) => {
    const k = i / (n - 1);
    const j = i === 0 || i === n - 1 ? 0 : (rnd(seed + i * 3.1) - 0.5) * jitter * (1 - Math.abs(k - 0.5));
    return [x0 + (x1 - x0) * k + j, y0 + (y1 - y0) * k + (rnd(seed + i) - 0.5) * 12];
  });
export const ptsPath = (p: [number, number][]) => 'M' + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');

/** A live bolt, redrawn every few frames, branching, glowing; `grow` 0 → 1 draws it down. */
export const LiveBolt: React.FC<{t: number; x0: number; y0: number; x1: number; y1: number; op: number; seed?: number; grow?: number}> = ({t, x0, y0, x1, y1, op, seed = 1, grow = 1}) => {
  const id = sid(useId());
  if (op <= 0) return null;
  const s = Math.floor(t * 10) + seed;
  const pts = boltPoints(x0, y0, x1, y1, 12, s, 70);
  const n = Math.max(2, Math.round(pts.length * clamp(grow)));
  const main = pts.slice(0, n);
  const fl = 0.55 + 0.45 * rnd(Math.floor(t * 30) + seed);
  const br = [3, 6, 9].filter((i) => i < n - 1).map((i) => boltPoints(pts[i]![0], pts[i]![1], pts[i]![0] + (rnd(s + i) - 0.5) * 260, pts[i]![1] + 90 + rnd(s + i + 1) * 120, 5, s + i, 30));
  return (
    <g opacity={op * fl}>
      <defs><filter id={`${id}b`}><feGaussianBlur stdDeviation="8" /></filter></defs>
      <path d={ptsPath(main)} stroke={LIGHT.violet} strokeWidth={16} fill="none" opacity={0.35} filter={`url(#${id}b)`} />
      <path d={ptsPath(main)} stroke="#f4f1ff" strokeWidth={4} fill="none" />
      {br.map((b, j) => <path key={j} d={ptsPath(b)} stroke="#dcd6ff" strokeWidth={2} fill="none" opacity={0.8} />)}
    </g>
  );
};

/** How bright the hall is under the lightning at t, from the strike instants (sala8's curve). */
export const strikeAt = (t: number, strikes: readonly number[]): number =>
  strikes.reduce((m, a) => {
    const d = t - a;
    return d < 0 || d > 0.7 ? m : Math.max(m, d < 0.06 ? 1 : d < 0.12 ? 0.35 : d < 0.2 ? 0.85 : Math.exp(-(d - 0.2) * 6) * 0.6);
  }, 0);

// --------------------------------------------------------------- teleport
/**
 * A column of light, rings on the floor, the figure breaking into slices and
 * sparks rising: k = 0 the whole figure, 1 gone. `floorY` is where it stands.
 */
export const Teleport: React.FC<{t: number; k: number; x: number; h: number; w?: number; floorY: number; children: React.ReactNode}> = ({t, k, x, h, w = 240, floorY, children}) => {
  const id = sid(useId());
  const peak = Math.sin(Math.PI * clamp(k));
  const top = floorY - h - 40;
  const N = 34;
  const sh = (h + 60) / N;
  const f = Math.floor(t * 30);
  return (
    <g>
      <defs>
        <linearGradient id={`${id}beam`} x1="0" x2="1"><stop offset="0" stopColor={LIGHT.cyan} stopOpacity="0" /><stop offset=".35" stopColor={LIGHT.cyan} stopOpacity=".35" /><stop offset=".5" stopColor="#ffffff" stopOpacity=".85" /><stop offset=".65" stopColor={LIGHT.cyan} stopOpacity=".35" /><stop offset="1" stopColor={LIGHT.cyan} stopOpacity="0" /></linearGradient>
        <filter id={`${id}cy`} x="-30%" y="-10%" width="160%" height="120%"><feFlood floodColor="#bff4ff" /><feComposite in2="SourceAlpha" operator="in" result="s" /><feGaussianBlur in="s" stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="s" /></feMerge></filter>
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
        return <ellipse key={j} cx={x} cy={floorY - ph * (h + 30)} rx={w * (0.55 + 0.15 * Math.sin(ph * Math.PI))} ry={22} fill="none" stroke={LIGHT.cyan} strokeWidth={3} opacity={peak * (1 - ph) * 0.9} />;
      })}
      <ellipse cx={x} cy={floorY} rx={w * 0.7} ry={30} fill={LIGHT.cyan} opacity={peak * 0.35} />
      <ellipse cx={x} cy={floorY} rx={w * (0.5 + 0.4 * peak)} ry={26} fill="none" stroke="#fff" strokeWidth={4} opacity={peak} />
      <g mask={`url(#${id}m)`}>
        <g opacity={1 - 0.35 * peak}>{children}</g>
        <g filter={`url(#${id}cy)`} opacity={peak * 0.75} transform={`translate(${(rnd(f) - 0.5) * 26 * peak} 0)`}>{children}</g>
      </g>
      {Array.from({length: 46}, (_, j) => {
        const sp = 0.35 + rnd(j + 3) * 0.6;
        const yy = floorY - ((t * sp + rnd(j)) % 1) * (h + 120);
        const xx = x + (rnd(j + 11) - 0.5) * w * 1.3;
        return <circle key={j} cx={xx} cy={yy} r={1.6 + rnd(j + 5) * 3} fill={j % 3 ? '#e8fbff' : LIGHT.cyan} opacity={peak * (0.4 + 0.6 * rnd(j + (f % 7)))} />;
      })}
    </g>
  );
};

// --------------------------------------------------------------- the camera
/** Seconds-based camera: the slow drift of a picture inside the screen (sala8's `camera(i)`). */
export const pictureCamera = (t: number, at: number, next: number, first: boolean, scale: number, move: {dx: number; dy: number; z: number; r: number}): React.CSSProperties => {
  const k = easeStage(clamp((t - at) / Math.max(0.4, next - at)));
  const drift = easeStage(clamp((k - 0.04) / 0.96));
  const pu = first ? 0 : 1 - easeStage(clamp((t - at) / 1.1));
  const mix = (a: number, b: number, q: number) => a + (b - a) * q;
  return {
    transform: `translate3d(${mix(-move.dx * 0.22, move.dx, drift) - 18 * pu}px,${mix(-move.dy * 0.22, move.dy, drift)}px,0) scale(${scale * (1 + move.z * k) * (1 + 0.05 * pu)}) rotate(${mix(-move.r * 0.35, move.r, k)}deg)`,
    filter: `brightness(${1.02 + 0.025 * k}) contrast(${1.045 + 0.025 * k}) saturate(${1.04 + 0.07 * k})`,
  };
};

// --------------------------------------------------------------- named effects
export interface FxContext {
  t: number;
  t0: number;
  t1: number;
  /** The screen's box in the frame. */
  frame: Box;
  color: string;
  /** Texture URLs the caller resolved: horizontal fog, water caustics. */
  textures: {fog?: string; caustics?: string};
}

type LiveFx = 'embers' | 'wind' | 'rain' | 'rays' | 'glow' | 'sweep' | 'fog' | 'water' | 'leaves' | 'birds';
const flick = (t: number) => 0.5 + 0.5 * (0.5 * Math.sin(t * 9.1) + 0.3 * Math.sin(t * 13.7 + 1) + 0.2 * Math.sin(t * 5.3 + 2));

/** Light and atmosphere in a picture (w × h), or leaking from it into the room (`room`: the screen's box). */
const LivingFx: React.FC<{fx: LiveFx; t: number; t0: number; w: number; h: number; c: string; room?: Box; fog?: string}> = ({fx, t, t0, w, h, c, room, fog}) => {
  const id = sid(useId());
  const dt = t - t0;
  const n = (k: number) => Array.from({length: k}, (_, i) => i + (room ? 40 : 0));
  let body: React.ReactNode = null;
  if (fx === 'embers') {
    const rise = room ? 420 : h * 0.8;
    body = (
      <>
        {!room && <rect x="0" y="0" width={w} height={h} fill={`url(#${id}glow)`} opacity={0.3 + 0.3 * flick(t)} />}
        {n(room ? 16 : 15).map((i) => {
          const P = 1.6 + 1.4 * rnd(i);
          const ph = ((t + rnd(i + 7) * P) % P) / P;
          const x0 = room ? (i % 3 === 0 ? room.x + rnd(i + 3) * room.w : room.x - 4) : rnd(i + 3) * w;
          const y0 = room ? (i % 3 === 0 ? room.y + 8 : room.y + room.h * (0.3 + 0.65 * rnd(i + 5))) : h * 0.98;
          const curl = Math.sin(ph * 5 + i * 2);
          const x = x0 + 20 * curl * ph - (room ? (90 + 170 * rnd(i + 9)) * ph : 0);
          const y = y0 - rise * ph;
          const len = 8 + 8 * rnd(i + 11);
          const tilt = 7 * Math.cos(ph * 5 + i * 2);
          const o = Math.sin(Math.PI * ph) ** 1.4 * (room ? 0.9 : 1);
          const d = `M${x} ${y} l${-tilt} ${len}`;
          return <g key={i} opacity={o}><path d={d} stroke={room ? '#ff8a1e' : '#ff9a3c'} strokeWidth="5" strokeLinecap="round" opacity=".3" /><path d={d} stroke={room ? '#e8590c' : '#ffe6a8'} strokeWidth={1.4 + 0.8 * rnd(i + 2)} strokeLinecap="round" /></g>;
        })}
      </>
    );
  }
  if (fx === 'wind') {
    body = (
      <>
        {!room && fog && <image href={fog} x={-dt * 110} y={h * 0.1} width={w + 500} height={h * 0.8} preserveAspectRatio="none" opacity=".22" />}
        {n(room ? 11 : 10).map((i) => {
          const sp = (room ? 300 : 400) + 180 * rnd(i);
          const L = 120 + 130 * rnd(i + 2);
          const span = room ? room.x + L : w + L;
          const dd = (t * sp + rnd(i + 4) * 3000) % span;
          const x = room ? room.x + 10 - dd : -L + dd;
          const y = (room ? room.y + 70 + rnd(i + 6) * (room.h - 140) : 24 + rnd(i + 6) * (h - 48)) + 5 * Math.sin(t * 2.2 + i);
          const o = room ? 0.9 * clamp((x + L) / (room.x * 0.7)) : 0.7;
          return <path key={i} d={`M${x} ${y} q${L / 2} ${-8 - 10 * rnd(i)} ${L} 0`} stroke={`url(#${id}wind)`} strokeWidth={room ? 1.6 + 1.8 * rnd(i + 8) : 1 + 1.5 * rnd(i + 8)} fill="none" strokeLinecap="round" opacity={o} />;
        })}
      </>
    );
  }
  if (fx === 'glow' || fx === 'water' || fx === 'leaves' || fx === 'birds') body = <rect x="0" y="0" width={w} height={h} fill={`url(#${id}soft)`} opacity={0.35 + 0.15 * Math.sin(t * 1.4)} />;
  if (fx === 'sweep') {
    const kk = ((t * 0.33) % 1.3) - 0.15;
    body = <rect x={-w} y={-h} width={w * 0.35} height={h * 3} fill={`url(#${id}sweep)`} transform={`translate(${kk * w * 2.2} 0) rotate(20)`} />;
  }
  if (fx === 'fog' && fog) body = <image href={fog} x={-dt * 16} y={h * 0.2} width={w + 120} height={h * 0.75} preserveAspectRatio="none" opacity=".6" />;
  return (
    <svg width={w} height={h} style={{position: 'absolute', inset: 0, overflow: 'visible', mixBlendMode: room ? 'normal' : 'screen'}}>
      <defs>
        <radialGradient id={`${id}glow`} cx=".5" cy="1" r=".9"><stop offset="0" stopColor="#ff8a2a" stopOpacity=".8" /><stop offset="1" stopColor="#ff8a2a" stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}soft`} cx=".5" cy=".2" r=".8"><stop offset="0" stopColor={c} stopOpacity=".7" /><stop offset="1" stopColor={c} stopOpacity="0" /></radialGradient>
        <linearGradient id={`${id}wind`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={room ? '#6b8199' : '#ffffff'} stopOpacity="0" /><stop offset=".6" stopColor={room ? '#6b8199' : '#ffffff'} stopOpacity=".95" /><stop offset="1" stopColor={room ? '#6b8199' : '#ffffff'} stopOpacity="0" /></linearGradient>
        <linearGradient id={`${id}sweep`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff6d8" stopOpacity=".45" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
      </defs>
      {body}
    </svg>
  );
};

/** Water light: a caustic texture drifting in two layers around and below the picture. */
const Caustics: React.FC<{t: number; fr: Box; texture?: string}> = ({t, fr, texture}) => {
  if (!texture) return null;
  const cx = fr.x + fr.w / 2 - 60;
  const cy = fr.y + fr.h * 0.72;
  const tex = `url(${texture})`;
  const layer = (size: number, dx: number, dy: number, op: number): React.CSSProperties => ({position: 'absolute', inset: 0, background: '#3d8cff', opacity: op, maskImage: tex, WebkitMaskImage: tex, maskSize: `${size}px ${size}px`, WebkitMaskSize: `${size}px ${size}px`, maskPosition: `${dx}px ${dy}px`, WebkitMaskPosition: `${dx}px ${dy}px`} as React.CSSProperties);
  const area = `radial-gradient(ellipse ${fr.w * 1.15}px ${fr.h * 0.8}px at ${cx}px ${cy}px, #000 0%, rgba(0,0,0,.6) 55%, rgba(0,0,0,0) 100%)`;
  return (
    <div style={{position: 'absolute', inset: 0, maskImage: area, WebkitMaskImage: area} as React.CSSProperties}>
      <div style={layer(420, t * 22, Math.sin(t * 0.8) * 18, 0.46)} />
      <div style={layer(300, -t * 16, t * 9, 0.3)} />
    </div>
  );
};

/** A small flock leaves the picture and crosses the hall. */
const Birds: React.FC<{t: number; t0: number; fr: Box; n?: number}> = ({t, t0, fr, n = 9}) => {
  const birds = Array.from({length: n}, (_, i) => ({d: 0.7 + 0.28 * i + 0.2 * rnd(i + 50), dur: 4.4 + 0.8 * rnd(i + 60), sx: 0.15 + 0.7 * rnd(i + 70), sy: 0.12 + 0.3 * rnd(i + 80), ex: fr.w + 120 + 160 * rnd(i + 90), ey: -260 - 260 * rnd(i + 95), s: 0.6 + 0.45 * rnd(i + 99)}));
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      {birds.map((b, i) => {
        const k = (t - t0 - b.d) / b.dur;
        if (k < 0 || k > 1) return null;
        const e = ease(k);
        const x = fr.x + fr.w * b.sx + (b.ex - fr.w * b.sx) * e;
        const y = fr.y + fr.h * b.sy + b.ey * e - 30 * Math.sin(Math.PI * k);
        const flap = Math.sin((t - t0) * 15 + i * 2.3);
        const o = clamp(k / 0.08) * clamp((1 - k) / 0.2);
        return (
          <g key={i} transform={`translate(${x} ${y}) scale(${1.8 * b.s * (1 + 0.4 * k)})`} opacity={o}>
            <path d={`M-18 ${-6 * flap} Q-9 ${-10 * flap - 4} 0 0 Q9 ${-10 * flap - 4} 18 ${-6 * flap}`} stroke="#1c1416" strokeWidth="3.6" fill="none" strokeLinecap="round" />
            <ellipse cx="0" cy="1" rx="5" ry="3" fill="#1c1416" />
          </g>
        );
      })}
    </svg>
  );
};

/** Dry leaves falling out of the picture. */
const Leaves: React.FC<{t: number; t0: number; fr: Box}> = ({t, t0, fr}) => {
  const cols = ['#b8562a', '#d98a2b', '#8a4a22', '#c9702e', '#a8642a', '#e0a040'];
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      {cols.map((c, i) => {
        const k = (t - t0 - 0.4 - 0.45 * i - 0.2 * rnd(i + 20)) / (4.2 + 0.8 * rnd(i + 30));
        if (k < 0 || k > 1) return null;
        const e = ease(k);
        const x0 = fr.x + fr.w * (0.1 + 0.75 * rnd(i + 40));
        const y0 = fr.y + fr.h * (0.35 + 0.5 * rnd(i + 45));
        const x = x0 - (260 + 200 * rnd(i + 50)) * e + 28 * Math.sin((t - t0) * 2.2 + i);
        const y = y0 + (260 + 220 * rnd(i + 55)) * e;
        const o = clamp(k / 0.1) * clamp((1 - k) / 0.25);
        const rot = (t - t0) * (70 + 60 * rnd(i + 60)) * (i % 2 ? 1 : -1);
        const sc = 1.3 + 0.5 * rnd(i + 65);
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${rot}) scale(${sc} ${sc * (0.55 + 0.45 * Math.abs(Math.cos((t - t0) * 3 + i)))})`} opacity={o}>
            <path d="M0 -14 Q11 -4 0 14 Q-11 -4 0 -14Z" fill={c} stroke="#5a2e12" strokeWidth="1.4" />
            <path d="M0 -12 L0 16" stroke="#5a2e12" strokeWidth="1.2" />
          </g>
        );
      })}
    </svg>
  );
};

const STRIKES = [0.35, 1.7, 2.55, 4.1, 5.6, 6.4, 8.0, 9.5];
const bolt = (x0: number, y0: number, x1: number, y1: number, seed: number) => {
  let d = `M${x0} ${y0}`;
  for (let i = 1; i <= 9; i++) {
    const k = i / 9;
    const j = i === 9 ? 0 : (rnd(seed + i) - 0.5) * 90;
    d += ` L${x0 + (x1 - x0) * k + j} ${y0 + (y1 - y0) * k + j * 0.35}`;
  }
  return d;
};

/** Lightning in a picture, or coming out of it into the hall with flashes on the wall. */
const Lightning: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; room: boolean; w?: number; h?: number}> = ({t, t0, t1, fr, color, room, w = 1080, h = 1920}) => {
  const id = sid(useId());
  const dt = t - t0;
  let fl = 0;
  let idx = -1;
  STRIKES.forEach((s, i) => {
    if (t0 + s > t1 - 0.4) return;
    const v = Math.exp(-((dt - s) ** 2) / 0.012) + 0.5 * Math.exp(-((dt - s - 0.16) ** 2) / 0.006);
    if (v > fl) {
      fl = v;
      idx = i;
    }
  });
  if (fl < 0.02) return null;
  if (!room) {
    return (
      <svg width={w} height={h} style={{position: 'absolute', inset: 0}}>
        <rect width={w} height={h} fill="#eef0ff" opacity={0.55 * fl} />
        <path d={bolt(w * (0.3 + 0.4 * rnd(idx + 3)), 0, w * (0.2 + 0.6 * rnd(idx + 9)), h * 0.75, idx * 13)} stroke="#fff" strokeWidth="5" fill="none" opacity={fl} />
      </svg>
    );
  }
  const side = idx % 3;
  const sx = side === 0 ? fr.x + 6 : side === 1 ? fr.x + fr.w * (0.25 + 0.5 * rnd(idx)) : fr.x + fr.w - 6;
  const sy = side === 1 ? fr.y + fr.h - 6 : fr.y + fr.h * (0.3 + 0.4 * rnd(idx + 1));
  const ex = side === 0 ? sx - 260 - 200 * rnd(idx + 2) : side === 1 ? sx + (rnd(idx + 4) - 0.5) * 500 : Math.min(1060, sx + 120);
  const ey = side === 1 ? sy + 380 + 160 * rnd(idx + 5) : sy + 300 + 260 * rnd(idx + 6);
  const d = bolt(sx, sy, ex, ey, idx * 31);
  const d2 = bolt(sx, sy, (sx + ex) / 2 + (rnd(idx + 8) - 0.5) * 220, (sy + ey) / 2 + 120, idx * 47);
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs><filter id={`${id}g`}><feGaussianBlur stdDeviation="9" /></filter></defs>
      <rect width="1080" height="1920" fill={color} opacity={0.14 * fl} style={{mixBlendMode: 'screen'}} />
      <rect width="1080" height="1920" fill="#f4f2ff" opacity={0.1 * fl} />
      <g opacity={Math.min(1, fl * 1.2)}>
        <path d={d} stroke={color} strokeWidth="26" fill="none" filter={`url(#${id}g)`} opacity=".9" />
        <path d={d} stroke="#ffffff" strokeWidth="5.5" fill="none" strokeLinejoin="round" />
        <path d={d2} stroke="#ffffff" strokeWidth="2.6" fill="none" opacity=".8" />
      </g>
    </svg>
  );
};

const JOLTS = [0.55, 1.45, 2.15, 3.2, 4.05, 5.3, 6.4, 7.6];
const jolt = (dt: number) => JOLTS.reduce((m, s, i) => Math.max(m, Math.exp(-((dt - s) ** 2) / 0.006) * (0.75 + 0.25 * rnd(i + 5))), 0);

/** The earth breathing and jolting: livid light from below in the picture, seismograph lines under it in the hall. */
const Tremor: React.FC<{t: number; t0: number; fr: Box; color: string; room: boolean; w?: number; h?: number}> = ({t, t0, fr, color, room, w = 1080, h = 1920}) => {
  const id = sid(useId());
  const dt = t - t0;
  if (dt < 0) return null;
  const k = ramp(t, t0, t0 + 0.5);
  const breath = 0.5 + 0.5 * Math.sin((2 * Math.PI * dt) / 1.7);
  const j = jolt(dt);
  const wave = (x0: number, x1: number, y: number, amp: number, seed: number) => {
    let d = '';
    for (let x = x0, i = 0; x <= x1; x += 8, i++) {
      const n = Math.sin(i * 0.9 + seed + dt * 31) * 0.6 + Math.sin(i * 2.3 + seed * 2 + dt * 47) * 0.4;
      d += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + (y + n * amp).toFixed(1);
    }
    return d;
  };
  if (!room) {
    return (
      <div style={{position: 'absolute', inset: 0, opacity: k, transform: `translate(${(6 * j * Math.sin(dt * 90)).toFixed(2)}px,${(3 * j).toFixed(2)}px)`}}>
        <div style={{position: 'absolute', inset: 0, mixBlendMode: 'screen', background: `linear-gradient(to top, ${color} 0%, rgba(0,0,0,0) ${55 + 12 * breath}%)`, opacity: 0.22 + 0.28 * breath + 0.25 * j}} />
        <div style={{position: 'absolute', inset: 0, background: '#eef3ff', opacity: 0.12 * j}} />
        <svg width={w} height={h} style={{position: 'absolute', inset: 0}}>
          {[0, 1, 2].map((i) => <path key={i} d={wave(0, w, h * (0.8 + 0.07 * i), 3 + 18 * j, i * 7)} stroke={color} strokeWidth={2.2} fill="none" opacity={(0.18 + 0.5 * j) * (1 - 0.25 * i)} />)}
        </svg>
      </div>
    );
  }
  const x0 = fr.x + 10;
  const x1 = fr.x + fr.w - 10;
  const y0 = fr.y + fr.h + 48;
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible', opacity: k}}>
      <defs><filter id={`${id}g`}><feGaussianBlur stdDeviation="5" /></filter></defs>
      {[0, 1, 2].map((i) => {
        const d = wave(x0, x1, y0 + i * 30, 2 + 26 * j * (1 - 0.2 * i), i * 11);
        return (
          <g key={i} opacity={(0.3 + 0.15 * breath + 0.5 * j) * (1 - 0.22 * i)}>
            <path d={d} stroke={color} strokeWidth={9} fill="none" filter={`url(#${id}g)`} opacity={0.7} />
            <path d={d} stroke="#f2f4ff" strokeWidth={1.8} fill="none" />
          </g>
        );
      })}
    </svg>
  );
};

/** Fog pouring from the base of the screen over the hall's floor. */
const RoomMist: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; fog?: string}> = ({t, t0, t1, fr, color, fog}) => {
  const k = ease(clamp((t - t0) / 2.6));
  const out = 1 - ease(clamp((t - (t1 - 1.6)) / 1.6));
  const dt = t - t0;
  if (k <= 0 || out <= 0 || !fog) return null;
  const cx = fr.x + fr.w / 2;
  const base = fr.y + fr.h;
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden'}}>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = base - 80 + i * 175 * k;
        const w = (fr.w + (1500 - fr.w) * k) * (1 + 0.12 * i);
        const dir = i % 2 ? 1 : -1;
        const x = cx - w / 2 + dir * (dt * (18 + 6 * i)) + 40 * Math.sin(dt * 0.4 + i);
        return <Img key={i} src={fog} style={{position: 'absolute', left: x, top: y, width: w, height: 300 + 60 * i, objectFit: 'cover', opacity: (0.62 - 0.07 * i) * k * out, filter: `blur(${4 + 2 * i}px) brightness(1.15) drop-shadow(0 0 30px ${color})`, mixBlendMode: 'screen', transform: `scaleX(${dir})`}} />;
      })}
      <div style={{position: 'absolute', left: 0, right: 0, top: base + 260 * k, height: 900, opacity: 0.35 * k * out, background: 'linear-gradient(rgba(235,240,255,.0), rgba(235,240,255,.75) 35%, rgba(235,240,255,.5))', filter: 'blur(18px)'}} />
    </div>
  );
};

/** Warm steam rising in curls from the lower part of the picture. */
const Steam: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string}> = ({t, t0, t1, fr, color}) => {
  const id = sid(useId());
  const on = ease(clamp((t - t0) / 0.8)) * (1 - ease(clamp((t - (t1 - 1)) / 1)));
  if (on <= 0) return null;
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs><filter id={`${id}b`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12" /></filter></defs>
      {Array.from({length: 14}, (_, i) => {
        const P = 3.2 + 1.2 * rnd(i + 3);
        const ph = ((t - t0 + rnd(i + 9) * P) % P) / P;
        const x0 = fr.x + fr.w * (0.12 + 0.76 * rnd(i + 5));
        const y0 = fr.y + fr.h * (0.62 + 0.25 * rnd(i + 11));
        const rise = 520 + 320 * rnd(i + 13);
        const y = y0 - rise * ph;
        const sw = 48 * Math.sin(ph * Math.PI * 1.6 + i);
        const o = Math.sin(Math.PI * ph) * 0.58 * on;
        const w = 40 + 80 * ph;
        const d = `M ${x0} ${y + 90} C ${x0 + sw} ${y + 50}, ${x0 - sw} ${y + 20}, ${x0 + sw * 0.6} ${y - 40}`;
        return <g key={i} opacity={o} filter={`url(#${id}b)`}><path d={d} stroke="#fff6f0" strokeWidth={w} strokeLinecap="round" fill="none" /><path d={d} stroke={color} strokeWidth={w * 0.5} strokeLinecap="round" fill="none" opacity={0.35} /></g>;
      })}
    </svg>
  );
};

/** Ribbons of light turning around the picture and widening into the hall. */
const Spell: React.FC<{t: number; t0: number; fr: Box; color: string}> = ({t, t0, fr, color}) => {
  const id = sid(useId());
  const dt = t - t0;
  const cx = fr.x + fr.w / 2;
  const cy = fr.y + fr.h / 2;
  const k = ease(clamp(dt / 1.6));
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs>
        <filter id={`${id}g`}><feGaussianBlur stdDeviation="7" /></filter>
        <linearGradient id={`${id}s`} x1="0" x2="1"><stop offset="0" stopColor={color} stopOpacity="0" /><stop offset=".5" stopColor="#fff3c4" stopOpacity="1" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>
      </defs>
      {[0, 1, 2].map((i) => {
        const rx = fr.w * (0.62 + 0.14 * i) * (0.6 + 0.4 * k);
        const ry = fr.h * (0.5 + 0.08 * i) * (0.6 + 0.4 * k);
        const rot = dt * (38 - 11 * i) * (i % 2 ? -1 : 1) + i * 40;
        const L = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
        return (
          <g key={i} transform={`rotate(${rot * 0.25} ${cx} ${cy})`}>
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={color} strokeWidth={20 - 4 * i} strokeDasharray={`${L * 0.3} ${L * 0.7}`} strokeDashoffset={-dt * (260 + 60 * i)} filter={`url(#${id}g)`} opacity={0.55 * k} />
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={`url(#${id}s)`} strokeWidth={5 - i} strokeDasharray={`${L * 0.3} ${L * 0.7}`} strokeDashoffset={-dt * (260 + 60 * i)} opacity={0.95 * k} strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
};

/** Notes of a whistle or a song flying out of the picture towards (x, y). */
const Notes: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; x?: number; y?: number}> = ({t, t0, t1, fr, color, x: X = 140, y: Y = 700}) => {
  const id = sid(useId());
  const sx = fr.x + fr.w * 0.4;
  const sy = fr.y + fr.h * 0.42;
  return (
    <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs><filter id={`${id}g`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="6" /></filter></defs>
      {Array.from({length: 8}, (_, i) => {
        const a = t0 + 0.5 * i;
        if (a > t1 - 1.4) return null;
        const k = clamp((t - a) / 3.4);
        if (k <= 0 || k >= 1) return null;
        const e = ease(k);
        const x = sx + (X - sx) * e + 26 * Math.sin(k * 9 + i);
        const y = sy + (Y - sy) * e - 120 * Math.sin(Math.PI * e) + 18 * Math.cos(k * 7 + i);
        const op = clamp(k / 0.12) * clamp((1 - k) / 0.3);
        const sc = (2.4 + 0.8 * rnd(i + 2)) * (0.5 + 0.5 * clamp(k / 0.25));
        const rot = -12 + 24 * Math.sin(k * 5 + i);
        const dbl = i % 3 === 1;
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${rot}) scale(${sc})`} opacity={op}>
            <g filter={`url(#${id}g)`} opacity={0.7}><ellipse cx={0} cy={0} rx={13} ry={9} transform="rotate(-20)" fill={color} /></g>
            <ellipse cx={0} cy={0} rx={12} ry={8.5} transform="rotate(-20)" fill="#2a1a10" stroke={color} strokeWidth={2} />
            <path d={`M 10 -3 L 10 -46 ${dbl ? 'L 40 -54 L 40 -11' : 'Q 26 -38 24 -20'}`} stroke="#2a1a10" strokeWidth={4} fill="none" strokeLinecap="round" />
            {dbl && <ellipse cx={30} cy={-8} rx={12} ry={8.5} transform="rotate(-20 30 -8)" fill="#2a1a10" stroke={color} strokeWidth={2} />}
          </g>
        );
      })}
    </svg>
  );
};

/** Options of a figure coming out of the picture. */
export interface FigureOpt {
  src?: string;
  x?: number;
  y?: number;
  w?: number;
  mode?: 'sale' | 'salpa' | 'scende';
  exit?: 'rientra' | 'svanisce';
  glow?: string;
}
const qbez = (a: number, b: number, c: number, k: number) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * b + k * k * c;

/** A cut-out figure leaves the picture with a flash and a trail of light, lives in the hall, and goes back (or fades). */
const Apparition: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; o: FigureOpt}> = ({t, t0, t1, fr, color, o}) => {
  const id = sid(useId());
  if (!o.src || t < t0 - 0.05 || t > t1 + 0.6) return null;
  const mode = o.mode ?? 'sale';
  const glow = o.glow ?? color;
  const cx0 = fr.x + fr.w / 2;
  const cy0 = fr.y + fr.h * 0.5;
  const X = o.x ?? cx0;
  const Y = o.y ?? fr.y + fr.h + 150;
  const W = o.w ?? 380;
  const IN = mode === 'salpa' ? 2.2 : 1.8;
  const OUT = 1.5;
  const dt = t - t0;
  const kin = ease(clamp(dt / IN));
  const back = o.exit === 'svanisce' ? 0 : ease(clamp((t - (t1 - OUT)) / OUT));
  const k = kin * (1 - back);
  const vx = mode === 'salpa' ? Math.min(cx0, X) - 140 : (cx0 + X) / 2 + 90;
  const vy = mode === 'scende' ? Math.max(cy0, Y) + 60 : Math.min(cy0, Y) - 170;
  const live = clamp(dt / IN) * (1 - back);
  const bob = mode === 'salpa' ? 14 * Math.sin(dt * 1.7) : 10 * Math.sin((dt * 2 * Math.PI) / 3.4);
  const x = qbez(cx0, vx, X, k) + (mode === 'salpa' ? 26 * Math.sin(dt * 0.55) * live : 0);
  const y = qbez(cy0, vy, Y, k) + bob * live;
  const rot = (mode === 'salpa' ? 3.2 * Math.sin(dt * 1.7 + 0.6) : 1.6 * Math.sin(dt * 1.3)) * live + (1 - k) * (mode === 'salpa' ? -14 : 8);
  const s = 0.16 + 0.84 * k;
  const fade = o.exit === 'svanisce' ? 1 - ease(clamp((t - (t1 - 1.1)) / 1.1)) : 1 - clamp((t - (t1 - 0.25)) / 0.25);
  const op = clamp(dt / 0.3) * fade;
  const mat = 1 - ease(clamp((dt - 0.2) / (IN * 0.8)));
  const flash = Math.max(Math.exp(-((dt - 0.18) ** 2) / 0.05), o.exit === 'svanisce' ? 0 : Math.exp(-((t - t1 + 0.15) ** 2) / 0.05));
  const trail = Math.sin(Math.PI * clamp(dt / (IN * 1.1))) * (1 - back) + Math.sin(Math.PI * back) * 0.8;
  const H = W * 1.05;
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <defs>
          <radialGradient id={`${id}F`}><stop offset="0" stopColor="#fffbea" stopOpacity="1" /><stop offset=".35" stopColor={glow} stopOpacity=".55" /><stop offset="1" stopColor={glow} stopOpacity="0" /></radialGradient>
          <filter id={`${id}B`}><feGaussianBlur stdDeviation="9" /></filter>
        </defs>
        {flash > 0.01 && <ellipse cx={cx0} cy={cy0} rx={fr.w * 0.85} ry={fr.h * 0.7} fill={`url(#${id}F)`} opacity={0.95 * flash} />}
        {trail > 0.01 && (
          <g filter={`url(#${id}B)`} opacity={0.85 * trail}>
            <path d={`M${cx0} ${cy0} Q${vx} ${vy} ${x} ${y}`} stroke={glow} strokeWidth="34" fill="none" strokeLinecap="round" opacity=".55" />
            <path d={`M${cx0} ${cy0} Q${vx} ${vy} ${x} ${y}`} stroke="#fffbea" strokeWidth="10" fill="none" strokeLinecap="round" />
          </g>
        )}
        <ellipse cx={x} cy={y + H * 0.12} rx={W * 0.62 * s} ry={H * 0.5 * s} fill={`url(#${id}F)`} opacity={(0.32 + 0.08 * Math.sin(dt * 2.4)) * op} />
      </svg>
      <Img src={o.src} style={{position: 'absolute', left: x - W / 2, top: y - H / 2, width: W, height: H, objectFit: 'contain', opacity: op, transform: `rotate(${rot}deg) scale(${s},${s})`, transformOrigin: '50% 60%', filter: `brightness(${1 + 1.6 * mat}) saturate(${1.15 - 0.4 * mat}) drop-shadow(0 0 3px #fffdf2) drop-shadow(0 0 3px #fffdf2) drop-shadow(0 0 22px ${glow}) drop-shadow(16px 26px 12px rgba(40,22,10,${0.3 * k}))`}} />
    </div>
  );
};

/** A translucent presence leaves the picture, floats like a veil, and dissolves rising (or goes back). */
const Ghost: React.FC<{t: number; t0: number; t1: number; fr: Box; color: string; o: FigureOpt}> = ({t, t0, t1, fr, color, o}) => {
  const id = sid(useId());
  if (t < t0 - 0.05 || t > t1 + 0.8) return null;
  const glow = o.glow ?? (color === '#ffffff' ? '#7fa6d9' : color);
  const dt = t - t0;
  const cx0 = fr.x + fr.w / 2;
  const cy0 = fr.y + fr.h * 0.5;
  const X = o.x ?? fr.x + fr.w * 0.2;
  const Y = o.y ?? fr.y + fr.h + 170;
  const W = o.w ?? 330;
  const H = W * 1.25;
  const IN = 2.4;
  const OUT = 2.0;
  const kin = ease(clamp(dt / IN));
  const back = o.exit === 'rientra' ? ease(clamp((t - (t1 - OUT)) / OUT)) : 0;
  const k = kin * (1 - back);
  const vx = (cx0 + X) / 2 - 60;
  const vy = Math.min(cy0, Y) - 120;
  const live = clamp(dt / IN);
  const out = o.exit === 'rientra' ? 0 : ease(clamp((t - (t1 - OUT)) / OUT));
  const x = qbez(cx0, vx, X, k) + 34 * Math.sin(dt * 0.7) * live;
  const y = qbez(cy0, vy, Y, k) + 16 * Math.sin(dt * 1.3) * live - 90 * out;
  const s = (0.3 + 0.7 * k) * (1 + 0.08 * out);
  const flickr = 0.86 + 0.14 * Math.sin(dt * 11) * Math.sin(dt * 3.7);
  const op = clamp(dt / 0.6) * (1 - out) * (o.exit === 'rientra' ? 1 - clamp((t - (t1 - 0.3)) / 0.3) : 1) * flickr;
  const seed = Math.floor(dt * 12) % 97;
  const bf = 0.01 + 0.004 * Math.sin(dt * 1.1);
  const fig = (dx: number, dy: number, a: number, key: string) =>
    o.src ? (
      <Img key={key} src={o.src} style={{position: 'absolute', left: x - W / 2 + dx, top: y - H / 2 + dy, width: W, height: H, objectFit: 'contain', opacity: a, transform: `scale(${s},${s})`, transformOrigin: '50% 70%', filter: `url(#${id}w) grayscale(1) sepia(.35) hue-rotate(175deg) saturate(1.6) brightness(1.08) contrast(1.05) drop-shadow(0 0 2px rgba(30,50,90,.55)) drop-shadow(0 0 18px ${glow})`}} />
    ) : (
      <svg key={key} width={W} height={H} viewBox="0 0 200 250" style={{position: 'absolute', left: x - W / 2 + dx, top: y - H / 2 + dy, opacity: a, transform: `scale(${s},${s})`, transformOrigin: '50% 70%', overflow: 'visible', filter: `url(#${id}w) drop-shadow(0 0 2px rgba(30,50,90,.6)) drop-shadow(0 0 16px ${glow})`}}>
        <defs><linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f4f8ff" stopOpacity=".97" /><stop offset=".5" stopColor="#b9cff0" stopOpacity=".85" /><stop offset=".8" stopColor={glow} stopOpacity=".55" /><stop offset="1" stopColor={glow} stopOpacity="0" /></linearGradient></defs>
        <path d={`M100 18 C70 18 56 44 58 74 C40 96 34 140 30 196 C44 ${214 + 8 * Math.sin(dt * 2)} 60 ${238 + 6 * Math.sin(dt * 2.6)} 78 ${226 + 8 * Math.sin(dt * 1.7)} C92 ${244 + 6 * Math.sin(dt * 2.2)} 108 ${244 + 6 * Math.sin(dt * 1.9)} 122 ${226 + 8 * Math.sin(dt * 2.4)} C140 ${238 + 6 * Math.sin(dt * 1.5)} 156 ${214 + 8 * Math.sin(dt * 2.1)} 170 196 C166 140 160 96 142 74 C144 44 130 18 100 18Z`} fill={`url(#${id}g)`} />
        <path d="M58 92 C42 120 34 150 26 170 M142 92 C158 120 166 150 174 170" stroke={glow} strokeOpacity=".5" strokeWidth="6" fill="none" strokeLinecap="round" />
        <ellipse cx="88" cy="66" rx="6" ry="9" fill="#2b3550" opacity=".55" />
        <ellipse cx="112" cy="66" rx="6" ry="9" fill="#2b3550" opacity=".55" />
      </svg>
    );
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      <svg width="0" height="0" style={{position: 'absolute'}}><filter id={`${id}w`} x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency={`${bf} ${bf * 2.2}`} numOctaves="2" seed={seed} /><feDisplacementMap in="SourceGraphic" scale={10 + 8 * (1 - k)} xChannelSelector="R" yChannelSelector="G" /></filter></svg>
      <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <defs><radialGradient id={`${id}m`}><stop offset="0" stopColor={glow} stopOpacity=".55" /><stop offset="1" stopColor={glow} stopOpacity="0" /></radialGradient><filter id={`${id}b`}><feGaussianBlur stdDeviation="14" /></filter></defs>
        <ellipse cx={cx0} cy={cy0} rx={fr.w * 0.7} ry={fr.h * 0.55} fill={`url(#${id}m)`} opacity={0.6 * Math.exp(-((dt - 0.4) ** 2) / 0.4)} />
        <path d={`M${cx0} ${cy0} Q${vx} ${vy} ${x} ${y}`} stroke={glow} strokeWidth="60" fill="none" strokeLinecap="round" filter={`url(#${id}b)`} opacity={0.35 * Math.sin(Math.PI * clamp(dt / (IN * 1.3)))} />
        <ellipse cx={x} cy={y + H * 0.42 * s} rx={W * 0.55 * s} ry={40 * s} fill={`url(#${id}m)`} opacity={0.5 * op} />
      </svg>
      {fig(-26 * Math.sin(dt * 0.7), 10, op * 0.18, 'e2')}
      {fig(-13 * Math.sin(dt * 0.7), 5, op * 0.32, 'e1')}
      {fig(0, 0, op * 0.82, 'f')}
    </div>
  );
};

// --------------------------------------------------------------- the catalogues
/** The effects a picture may carry: drawn inside the screen, and some also in the hall. */
export const PICTURE_FX = ['nebbia', 'vento', 'acqua', 'bagliore', 'fuoco', 'riflesso', 'uccelli', 'fulmini', 'sussulto'] as const;
export type PictureFx = (typeof PICTURE_FX)[number];

/** Inside the screen (w × h: the screen's inner size). */
export const pictureFx = (name: PictureFx, c: FxContext & {w: number; h: number}): React.ReactNode => {
  const live = (fx: LiveFx) => <LivingFx fx={fx} t={c.t} t0={c.t0} w={c.w} h={c.h} c={c.color} fog={c.textures.fog} />;
  switch (name) {
    case 'nebbia': return live('fog');
    case 'vento': return live('wind');
    case 'acqua': return live('water');
    case 'bagliore': return live('glow');
    case 'fuoco': return live('embers');
    case 'riflesso': return live('sweep');
    case 'uccelli': return live('birds');
    case 'fulmini': return <Lightning t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} room={false} w={c.w} h={c.h} />;
    case 'sussulto': return <Tremor t={c.t} t0={c.t0} fr={c.frame} color={c.color} room={false} w={c.w} h={c.h} />;
  }
};

/** What a picture's effect does in the hall, around the screen (null for those that stay inside). */
export const pictureFxInRoom = (name: PictureFx, c: FxContext): React.ReactNode => {
  switch (name) {
    case 'vento': return <LivingFx fx="wind" t={c.t} t0={c.t0} w={1080} h={1920} c={c.color} room={c.frame} />;
    case 'acqua': return <Caustics t={c.t} fr={c.frame} texture={c.textures.caustics} />;
    case 'fuoco': return <LivingFx fx="embers" t={c.t} t0={c.t0} w={1080} h={1920} c={c.color} room={c.frame} />;
    case 'uccelli': return <Birds t={c.t} t0={c.t0} fr={c.frame} n={12} />;
    case 'fulmini': return <Lightning t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} room />;
    case 'sussulto': return <Tremor t={c.t} t0={c.t0} fr={c.frame} color={c.color} room />;
    default: return null;
  }
};

/** The effects that live in the hall on their own (a room-effect item each). */
export const ROOM_FX = ['nebbia-sala', 'vapore', 'note', 'uccelli', 'foglie', 'incanto', 'apparizione', 'fantasma'] as const;
export type RoomFx = (typeof ROOM_FX)[number];

export const roomFx = (name: RoomFx, c: FxContext & {figure: FigureOpt}): React.ReactNode => {
  switch (name) {
    case 'nebbia-sala': return <RoomMist t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color === '#ffffff' ? '#dfe8ff' : c.color} fog={c.textures.fog} />;
    case 'vapore': return <Steam t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} />;
    case 'note': return <Notes t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color === '#ffffff' ? '#ffd38a' : c.color} {...(c.figure.x !== undefined ? {x: c.figure.x} : {})} {...(c.figure.y !== undefined ? {y: c.figure.y} : {})} />;
    case 'uccelli': return <Birds t={c.t} t0={c.t0} fr={c.frame} n={12} />;
    case 'foglie': return <Leaves t={c.t} t0={c.t0} fr={c.frame} />;
    case 'incanto': return <Spell t={c.t} t0={c.t0} fr={c.frame} color={c.color} />;
    case 'apparizione': return <Apparition t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} o={c.figure} />;
    case 'fantasma': return <Ghost t={c.t} t0={c.t0} t1={c.t1} fr={c.frame} color={c.color} o={c.figure} />;
  }
};
