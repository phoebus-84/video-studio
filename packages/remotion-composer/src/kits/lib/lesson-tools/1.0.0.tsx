// lesson-tools@1.0.0 — released: never edit this file; add lesson-tools/<next>.tsx instead (ADR-0039, ADR-0040).
// What the lesson's teaching tools draw with, channel-neutral: SVG text with
// a dark outline, glass chips and tags, titles that light up, waves, eyelids,
// the living iris, a picture breaking into shards, wind, smoke and lines of
// light. Rewritten from CreativeStudio's poesie-museo-long runtime (v10/ui.tsx,
// v10/fx7.tsx, fx.tsx, v3/fx3.tsx); colours from the look's roles, SVG ids
// unique per instance.

import React, {useId} from 'react';
import {z} from 'zod';
import {clamp, ease, rnd} from '../stage-math/1.0.0.js';
import {alpha, type ColorRole, type Look} from '../look/1.0.0.js';
import {Cover, type Box, type Point, ptsPath} from '../lesson-stage/1.0.0.js';
import {AssetUrl} from '../stage-props/1.0.0.js';
import {textWidth, type Face} from '../font-metrics/1.0.0.js';

const sid = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');

/** CSS families of the look's font roles (from useLookFonts). */
export interface Families {
  display: string;
  serif: string;
  sans: string;
}

/** A colour named by a look role, or the role's default. */
export const roleColor = (look: Look, role: ColorRole | undefined, fallback: ColorRole = 'text'): string => look.colors[role ?? fallback];

/** CreativeStudio's overshooting ease for things that land. */
export const back = (x: number): number => {
  const t = clamp(x);
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/** SVG text with a dark outline under light colours, at the size given: kits fit it, and nothing enlarges it past its room. */
export const SvgText: React.FC<{
  look: Look; fonts: Families; x: number; y: number; size: number; children: React.ReactNode;
  role?: 'display' | 'serif' | 'sans'; color?: string; anchor?: 'start' | 'middle' | 'end'; op?: number; weight?: number; ls?: number; italic?: boolean;
}> = ({look, fonts, x, y, size, children, role = 'sans', color, anchor = 'start', op = 1, weight = 400, ls = 0, italic = false}) => {
  const fill = color ?? look.colors.text;
  const px = size;
  const dark = fill === look.colors.ink;
  return (
    <text x={x} y={y} fontSize={px} fontFamily={fonts[role]} fill={fill} textAnchor={anchor} opacity={op} fontWeight={weight} letterSpacing={ls} fontStyle={italic ? 'italic' : undefined}
      {...(dark ? {} : {stroke: alpha(look.colors.shadow, 1), strokeWidth: Math.max(2.5, px * 0.07), paintOrder: 'stroke', strokeLinejoin: 'round'})}>{children}</text>
  );
};

/** A chip's size and width: its text measured with its tracking (0.12 em) and padding (0.8 em each side), shrunk to fit `room`. */
export const chipSize = (face: Face, text: string, size: number, room: number): {size: number; width: number} => {
  const fit = fitLine(face, [text], room, size, (s) => s * 0.12, (s) => s * 1.6);
  return {size: fit, width: textWidth(face, text, fit, fit * 0.12) + fit * 1.6};
};

/** A chip of text on dark glass with an accent line on top, and an optional second line; measured, and never wider than `room`. */
export const GlassChip: React.FC<{look: Look; fonts: Families; x: number; y: number; text: string; op?: number; size?: number; color?: string; anchor?: 'start' | 'middle'; sub?: string; room?: number}> =
  ({look, fonts, x, y, text, op = 1, size: nominal = 34, color, anchor = 'middle', sub, room = 900}) => {
    if (op <= 0) return null;
    const main = chipSize({family: look.fonts.sans, weight: 400}, text, nominal, room);
    const size = main.size;
    const subFace = {family: look.fonts.sans, weight: 400};
    const subSize = sub ? fitLine(subFace, [sub], room - size * 1.6, Math.max(look.measures.minTextPx, size * 0.55), () => 2) : 0;
    const w = Math.max(main.width, sub ? textWidth(subFace, sub, subSize, 2) + size * 1.6 : 0);
    const h = size * (sub ? 2.5 : 1.75);
    const x0 = anchor === 'middle' ? x - w / 2 : x;
    return (
      <g opacity={op}>
        <rect x={x0} y={y - h / 2} width={w} height={h} rx={h * 0.18} fill={alpha(look.colors.plate, 0.85)} stroke={look.colors.plateLine} strokeWidth="1.2" />
        <rect x={x0 + 10} y={y - h / 2} width={w - 20} height={1.5} fill={look.colors.accent} opacity=".9" />
        <SvgText look={look} fonts={fonts} x={x0 + w / 2} y={y + (sub ? -size * 0.1 : size * 0.35)} size={size} anchor="middle" ls={size * 0.12} color={color}>{text}</SvgText>
        {sub ? <SvgText look={look} fonts={fonts} x={x0 + w / 2} y={y + size * 0.85} size={subSize} anchor="middle" ls={2} color={look.colors.textDim}>{sub}</SvgText> : null}
      </g>
    );
  };

/** A minimal label with a dash before it. */
export const Tag: React.FC<{look: Look; fonts: Families; x: number; y: number; text: string; op?: number; color?: string; size?: number; anchor?: 'start' | 'middle'}> =
  ({look, fonts, x, y, text, op = 1, color, size = 28, anchor = 'start'}) => {
    const c = color ?? look.colors.accent;
    return (
      <g opacity={op}>
        {anchor === 'start' ? <rect x={x} y={y - size * 0.42} width={size * 1.4} height={2} fill={c} /> : null}
        <SvgText look={look} fonts={fonts} x={anchor === 'start' ? x + size * 2 : x} y={y} size={size} weight={600} ls={size * 0.2} color={c} anchor={anchor}>{text}</SvgText>
      </g>
    );
  };

/** A title that lights up at `at`: its tracking closes and it fades in; it fades out after `until`. */
export const LightTitle: React.FC<{look: Look; fonts: Families; t: number; at: number; x: number; y: number; size: number; text: string; color?: string; anchor?: 'start' | 'middle' | 'end'; until?: number; weight?: number; role?: 'display' | 'serif' | 'sans'; italic?: boolean}> =
  ({look, fonts, t, at, x, y, size, text, color, anchor = 'middle', until = 1e9, weight = 300, role = 'sans', italic = false}) => {
    if (t < at - 0.01 || t > until + 0.4) return null;
    const k = ease((t - at) / 0.6);
    const op = Math.min(clamp((t - at) / 0.25), 1 - clamp((t - until) / 0.4));
    return (
      <g opacity={op}>
        <SvgText look={look} fonts={fonts} x={x} y={y} size={size} color={color} anchor={anchor} weight={weight} role={role} italic={italic} ls={(1 - k) * size * 0.25 + (italic ? 0 : size * 0.04)}>{text}</SvgText>
      </g>
    );
  };

/** A wave: calm (chaos 0) or agitated (chaos 1). */
export const wavePath = (x: number, y: number, w: number, amp: number, t: number, chaos: number): string => {
  let d = `M${x} ${y}`;
  for (let i = 1; i <= 120; i++) {
    const k = i / 120;
    const a = amp * (chaos * (Math.sin(k * 41 + t * 9) * 0.6 + Math.sin(k * 97 - t * 13) * 0.4 + (rnd(i + Math.floor(t * 12)) - 0.5) * 0.9) + (1 - chaos) * Math.sin(k * 8 + t * 2) * 0.04);
    d += ` L${(x + w * k).toFixed(1)} ${(y + a).toFixed(1)}`;
  }
  return d;
};

/** Eyelids closing over (cx, cy): black with an almond opening (open 0 = closed), edged in the highlight. */
export const Eyelids: React.FC<{look: Look; open: number; cx: number; cy: number; w?: number}> = ({look, open, cx, cy, w = 2600}) => {
  if (open >= 0.999) return null;
  const h = 1500 * clamp(open);
  const top = `M${cx - w / 2} ${cy} Q${cx} ${cy - h} ${cx + w / 2} ${cy}`;
  const bot = `M${cx - w / 2} ${cy} Q${cx} ${cy + h} ${cx + w / 2} ${cy}`;
  return (
    <g>
      <path d={`${top} L${cx + w / 2} ${cy - 3000} L${cx - w / 2} ${cy - 3000} Z`} fill="#000" />
      <path d={`${bot} L${cx + w / 2} ${cy + 3000} L${cx - w / 2} ${cy + 3000} Z`} fill="#000" />
      <path d={top} stroke={look.colors.highlight} strokeWidth="5" fill="none" opacity={0.6 * (1 - clamp(open))} />
      <path d={bot} stroke={look.colors.highlight} strokeWidth="5" fill="none" opacity={0.6 * (1 - clamp(open))} />
    </g>
  );
};

/**
 * The living iris: copies of the same picture, masked to the iris and the
 * pupil around their measured centre (ex, ey, in the box), turning a little
 * and breathing. Nothing is drawn over the picture: it moves itself.
 */
export const IrisLive: React.FC<{t: number; src: string; box: Box; cx: number; cy: number; zoom: number; ex: number; ey: number; r: number; op?: number}> =
  ({t, src, box, cx, cy, zoom, ex, ey, r, op = 1}) => {
    if (op <= 0 || r <= 0) return null;
    const rot = 0.9 * Math.sin(t * 0.5);
    const dil = 1 + 0.045 * Math.sin(t * 1.1) ** 2;
    const mask = (rad: number) => `radial-gradient(circle ${rad}px at ${ex}px ${ey}px, #000 55%, transparent 100%)`;
    const layer = (rad: number, tr: string) => (
      <div style={{position: 'absolute', inset: 0, WebkitMaskImage: mask(rad), maskImage: mask(rad), opacity: op}}>
        <div style={{position: 'absolute', inset: 0, transformOrigin: `${ex}px ${ey}px`, transform: tr}}><Cover src={src} box={box} cx={cx} cy={cy} zoom={zoom} /></div>
      </div>
    );
    return <>{layer(r * 0.86, `rotate(${rot}deg)`)}{layer(r * 0.45, `rotate(${rot}deg) scale(${dil})`)}</>;
  };

const SHARDS: [number, number][][] = (() => {
  const cols = 5;
  const rows = 3;
  const P = (i: number, j: number): [number, number] => {
    const edgeX = i === 0 || i === cols;
    const edgeY = j === 0 || j === rows;
    return [i / cols + (edgeX ? 0 : (rnd(i * 7 + j * 13) - 0.5) * 0.12), j / rows + (edgeY ? 0 : (rnd(i * 5 + j * 11 + 3) - 0.5) * 0.18)];
  };
  const out: [number, number][][] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const a = P(i, j);
    const b = P(i + 1, j);
    const c = P(i + 1, j + 1);
    const d = P(i, j + 1);
    if ((i + j) % 2) out.push([a, b, c], [a, c, d]);
    else out.push([a, b, d], [b, c, d]);
  }
  return out;
})();

/** A picture breaking into triangles that fly into the room: k 0 whole, 1 gone. */
export const Shards: React.FC<{look: Look; src: string; box: Box; k: number; cx?: number; cy?: number; zoom?: number; filter?: string}> = ({look, src, box, k, cx = 0.5, cy = 0.5, zoom = 1, filter}) => (
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
        <div key={i} style={{position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, clipPath: `polygon(${tri.map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(',')})`,
          transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${1 - 0.25 * k})`, transformOrigin: `${mx * 100}% ${my * 100}%`, opacity: 1 - clamp((k - 0.7) / 0.3),
          filter: `drop-shadow(0 0 6px ${alpha(look.colors.glow, 0.6 * Math.min(1, k * 4))})`}}>
          <Cover src={src} box={{x: 0, y: 0, w: box.w, h: box.h}} cx={cx} cy={cy} zoom={zoom} filter={filter} />
          <div style={{position: 'absolute', inset: 0, background: `linear-gradient(${rnd(i) * 360}deg, rgba(255,255,255,${0.25 * Math.min(1, k * 5)}), rgba(255,255,255,0) 50%)`}} />
        </div>
      );
    })}
  </>
);

/** Wind: curved streaks crossing the frame and leaves flying. */
export const Wind: React.FC<{look: Look; t: number; opacity?: number; strength?: number; y0?: number; y1?: number; leaves?: number}> = ({look, t, opacity = 0.6, strength = 1, y0 = 80, y1 = 1000, leaves = 10}) => (
  <g opacity={opacity}>
    {Array.from({length: 14}, (_, i) => {
      const sp = (900 + rnd(i * 3) * 900) * strength;
      const len = 220 + rnd(i * 5) * 380;
      const x = ((rnd(i * 7) * 2600 + t * sp) % 2600) - 400;
      const y = y0 + rnd(i * 11) * (y1 - y0);
      return <path key={i} d={`M${x} ${y} q ${len * 0.5} ${18 * Math.sin(t * 2 + i)} ${len} 0`} stroke={look.colors.glow} strokeWidth={1.5 + rnd(i) * 2.5} fill="none" strokeLinecap="round" opacity={0.25 + 0.5 * rnd(i * 17)} />;
    })}
    {Array.from({length: leaves}, (_, i) => {
      const sp = (500 + rnd(i * 23) * 600) * strength;
      const x = ((rnd(i * 29) * 2400 + t * sp) % 2400) - 240;
      const y = y0 + rnd(i * 31) * (y1 - y0) + Math.sin(t * 3 + i) * 50;
      return <ellipse key={`l${i}`} cx={x} cy={y} rx={14} ry={6} fill={i % 2 ? look.colors.glow : look.colors.highlight} transform={`rotate(${(t * 360 * (1 + rnd(i))) % 360} ${x} ${y})`} opacity=".85" />;
    })}
  </g>
);

/** Smoke: blurred puffs that rise and widen. */
export const Smoke: React.FC<{look: Look; t: number; box: Box; n?: number; opacity?: number; rise?: number}> = ({look, t, box, n = 14, opacity = 0.5, rise = 40}) => {
  const id = sid(useId());
  return (
    <g opacity={opacity}>
      <defs><filter id={`${id}b`}><feGaussianBlur stdDeviation="18" /></filter></defs>
      <g filter={`url(#${id}b)`}>
        {Array.from({length: n}, (_, i) => {
          const life = 7 + rnd(i * 5) * 5;
          const ph = ((t + rnd(i * 3) * life) % life) / life;
          const x = box.x + rnd(i * 7) * box.w + Math.sin(t * 0.4 + i) * 60 + ph * 120 * (rnd(i) - 0.3);
          const y = box.y + box.h - ph * (box.h * 0.9 + rise);
          return <circle key={i} cx={x} cy={y} r={60 + ph * 220 * (0.6 + rnd(i * 11))} fill={look.colors.glow} opacity={Math.sin(Math.PI * ph) * (0.25 + 0.3 * rnd(i * 13))} />;
        })}
      </g>
    </g>
  );
};

/** A line of light: a glow, a body and a white core, along a path. */
export const LightLine: React.FC<{look: Look; d: string; op?: number; width?: number}> = ({look, d, op = 1, width = 6}) => {
  const id = sid(useId());
  if (op <= 0) return null;
  return (
    <g opacity={op}>
      <defs><filter id={`${id}b`}><feGaussianBlur stdDeviation="8" /></filter></defs>
      <path d={d} stroke={look.colors.glow} strokeWidth={width * 4} fill="none" strokeLinejoin="round" strokeLinecap="round" opacity=".35" filter={`url(#${id}b)`} />
      <path d={d} stroke={look.colors.glow} strokeWidth={width * 1.6} fill="none" strokeLinejoin="round" strokeLinecap="round" opacity=".7" />
      <path d={d} stroke="#fff" strokeWidth={width * 0.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </g>
  );
};

/** Where a point of the picture (px, py, 0–1) lands on screen, framed in `box` as Cover frames it (object-fit cover). */
export const coverPoint = (box: Box, imgW: number, imgH: number, cx: number, cy: number, zoom: number, px: number, py: number): Point => {
  const s = Math.max(box.w / imgW, box.h / imgH);
  const w = imgW * s;
  const h = imgH * s;
  // object-position cx cy: the image's free room is shared in that proportion
  const left = (box.w - w) * cx;
  const top = (box.h - h) * cy;
  // then scaled by zoom about the same point (cx, cy) of the box
  const ox = box.w * cx;
  const oy = box.h * cy;
  return [box.x + ox + (left + px * w - ox) * zoom, box.y + oy + (top + py * h - oy) * zoom];
};

/** The picture a figure tool works on: its focus (0–1) and its aspect (width / height, to find points on it). */
export const PictureSchema = z.object({
  src: AssetUrl,
  focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  aspect: z.number().positive().max(4).optional(),
}).strict();
export interface Picture {src: string; focus?: [number, number]; aspect?: number}

/**
 * The largest size, at most `max`, at which every line fits in `width` px
 * with its letter spacing `ls(size)` and the room its plate takes, `pad(size)`
 * (padding, border, shadow: what font-metrics' fitSize does not count).
 */
export const fitLine = (face: Face, lines: readonly string[], width: number, max: number, ls: (s: number) => number = () => 0, pad: (s: number) => number = () => 0): number => {
  const fits = (s: number) => lines.every((l) => textWidth(face, l, s, ls(s)) + pad(s) <= width);
  if (fits(max)) return max;
  let lo = 1;
  let hi = max;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
};

/**
 * A verse read as words: each word's length in letters and digits, and the
 * punctuation after it (seen behind closing quotes and brackets); tokens with
 * no letter or digit (a dash, a quote) are not words.
 */
export const verseTokens = (line: string): {len: number; p: string}[] =>
  line.split(/\s+/).flatMap((tok) => {
    const len = tok.replace(/[^\p{L}\p{N}]/gu, '').length;
    if (!len) return [];
    const bare = tok.replace(/[»”"’')\]]+$/u, '');
    return [{len, p: /[,;:.!?]$/u.exec(bare)?.[0] ?? ''}];
  });

/**
 * The line each label goes on, in order of x: the first line where it does
 * not touch the label before it there (`gap` px apart), adding lines as needed.
 */
export const labelLines = (xs: readonly number[], widths: readonly number[], gap: number): number[] => {
  const ends: number[] = [];
  return xs.map((x, i) => {
    const half = widths[i]! / 2;
    let j = ends.findIndex((e) => x - half >= e + gap);
    if (j < 0) j = ends.push(-Infinity) - 1;
    ends[j] = x + half;
    return j;
  });
};

/** The colour roles a text or a mark may take (never a plate's or a shadow's). */
export const TEXT_ROLES = ['text', 'textDim', 'accent', 'highlight', 'glow', 'lightning', 'signal'] as const;

/** The panel's default box in a 16:9 frame. */
export const PANEL: Box = {x: 440, y: 150, w: 1060, h: 596};

export {ptsPath};
