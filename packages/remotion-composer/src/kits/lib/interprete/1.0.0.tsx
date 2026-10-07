// interprete@1.0.0 — released: never edit this file; add interprete/<next>.tsx instead (ADR-0039).
// The interprete: an SVG actor or actress (CreativeStudio's characters/
// interprete), a purely visual figure on an angular pose rig. Whoever uses it
// works out pose, expression, gaze, mouth, blink, bow and liveliness from the
// time and passes them in. Rewritten clean: the palette travels as a value
// (never a module-level variable), so two figures in one frame never mix.

import React from 'react';

export interface Pose {
  /** Upper arm and forearm angles, left and right (degrees). */
  lu: number;
  lf: number;
  ru: number;
  rf: number;
  head: number;
  lean: number;
  /** 0 open hands, 1 fists. */
  grip: number;
  step: number;
  twist: number;
  dip: number;
}
export const REST: Pose = {lu: 7, lf: 4, ru: 7, rf: 4, head: 0, lean: 0, grip: 0, step: 0, twist: 0, dip: 0};

/** Gestures, merged with explicit angles. */
export const POSE_PRESETS: Record<string, Partial<Pose>> = {
  riposo: {},
  invoca: {lu: 20, lf: 54, ru: 20, rf: 54, head: -2, step: 1},
  'mani-al-cuore': {lu: 38, lf: 92, ru: 22, rf: 60, head: -4, lean: 2},
  indica: {ru: 126, rf: 140, head: 4},
  apre: {lu: 62, lf: 72, ru: 62, rf: 72, head: -4, step: 1},
  chiede: {lu: 56, lf: 72, ru: 56, rf: 72, head: -4, step: 1},
  dialoga: {lu: 34, lf: 88, ru: 34, rf: 88, head: -5, dip: 1},
  spalle: {lu: 24, lf: 110, ru: 24, rf: 110, head: -3, twist: 1},
  'braccio-alto': {lu: 66, lf: 78, ru: 20, rf: 58, head: -3, step: 1},
};

/** Eyebrows (inner, outer; left, right) and the resting smile. */
export interface Expr {
  li: number;
  lo: number;
  ri: number;
  ro: number;
  sm: number;
}
/** N neutral, A frowning, W amazed, I curious, M melancholy, S smiling. */
export const EXPR: Record<'N' | 'A' | 'W' | 'I' | 'M' | 'S', Expr> = {
  N: {li: 0, lo: 0, ri: 0, ro: 0, sm: 0.25},
  A: {li: -6, lo: 3, ri: -6, ro: 3, sm: -0.5},
  W: {li: 7, lo: 6, ri: 7, ro: 6, sm: 0},
  I: {li: 7, lo: 5, ri: -2, ro: 0, sm: 0.8},
  M: {li: 6, lo: -3, ri: 6, ro: -3, sm: -0.6},
  S: {li: 3, lo: 2, ri: 3, ro: 2, sm: 0.9},
};

export interface Palette {
  ink: string;
  shirt: string;
  shirtDark: string;
  vest: string;
  vestLight: string;
  button: string;
  inner: string;
  innerDark: string;
  skin: string;
  skinDark: string;
  trousers: string;
  shoe: string;
  sole: string;
  hair?: string;
  hairHi?: string;
  hairGloss?: string;
  lip?: string;
  freckles?: string;
}
/** Costumes: colours change with every poem, never period costumes. */
export const PALETTES: Record<string, Palette> = {
  'attore-saffo': {ink: '#2e2620', shirt: '#c52f87', shirtDark: '#8d1f60', vest: '#c52f87', vestLight: '#f064ad', button: '#164f56', inner: '#0799a5', innerDark: '#056a73', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#34373b', shoe: '#fafaf5', sole: '#dcd8cc'},
  'attore-infinito': {ink: '#2e2620', shirt: '#12a6b8', shirtDark: '#ff5a4e', vest: '#12a6b8', vestLight: '#0b7480', button: '#1d3a40', inner: '#ff5a4e', innerDark: '#d63c32', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#1b2a5c', shoe: '#fafaf5', sole: '#dcd8cc'},
  'attrice-saffo': {ink: '#2e2620', shirt: '#d26068', shirtDark: '#9f3e4b', vest: '#078c78', vestLight: '#55c9ae', button: '#f0bd43', inner: '#d26068', innerDark: '#9f3e4b', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#49334f', shoe: '#fafaf5', sole: '#dcd8cc'},
  'attrice-dante': {ink: '#2e2620', shirt: '#f2b632', shirtDark: '#c4860f', vest: '#1f4fbf', vestLight: '#5f8ae6', button: '#f7e6a6', inner: '#f2b632', innerDark: '#c4860f', skin: '#f6b386', skinDark: '#cf7c4e', trousers: '#2a2452', shoe: '#fafaf5', sole: '#dcd8cc', hair: '#3b2216', hairHi: '#6e4127', hairGloss: '#a06a43'},
};

export interface Gaze {
  x: number;
  y: number;
  h: number;
}

export type Variant = 'attore' | 'attrice';

const HAIR_DEFAULTS: Record<Variant, Required<Pick<Palette, 'hair' | 'hairHi' | 'hairGloss' | 'lip' | 'freckles'>>> = {
  attore: {hair: '#111214', hairHi: '#8fa6c9', hairGloss: '#ffffff', lip: '#7a4636', freckles: '#b96b4c'},
  attrice: {hair: '#ad4d2c', hairHi: '#f08a4b', hairGloss: '#ffd0a2', lip: '#a34258', freckles: '#b96b4c'},
};
/** A costume with the variant's hair, lips and freckles where it gives none. */
export const fullPalette = (p: Palette, v: Variant): Required<Palette> =>
  ({...HAIR_DEFAULTS[v], ...Object.fromEntries(Object.entries(p).filter(([, x]) => x !== undefined))}) as Required<Palette>;

const rad = (a: number) => (a * Math.PI) / 180;
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
type C = Required<Palette>;

const finger = (c: C, x: number, w: number, len: number) => (
  <path d={`M${x} 9 L${x} ${len - 6} Q${x} ${len + 2.5} ${x + w / 2} ${len + 2.5} Q${x + w} ${len + 2.5} ${x + w} ${len - 6} L${x + w} 9 Z`} fill={c.skin} stroke={c.ink} strokeWidth="2.1" strokeLinejoin="round" />
);

/** Open hand (palm, four fingers, thumb) or fist. */
const Hand: React.FC<{c: C; side: number; grip: number}> = ({c, side, grip}) => (
  <g transform={`scale(${-side} 1)`}>
    {grip > 0.5 ? (
      <g>
        <path d="M-14 -5 Q0 -12 14 -5 L14 13 Q14 25 0 27 Q-14 25 -14 13 Z" fill={c.skin} stroke={c.ink} strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M-12 -4 Q-9 -10 -6 -4 M-3 -4 Q0 -10 3 -4 M5 -4 Q8 -10 11 -4" fill="none" stroke={c.ink} strokeWidth="2" strokeLinecap="round" />
        <path d="M-14 8 Q-20 12 -18 19 Q-14 24 -8 22" fill={c.skin} stroke={c.ink} strokeWidth="2.2" strokeLinejoin="round" />
      </g>
    ) : (
      <g>
        <path d="M-15 -4 L15 -4 L15 7 Q16 15 8 17 L-8 17 Q-16 15 -15 7 Z" fill={c.skin} stroke={c.ink} strokeWidth="2.3" strokeLinejoin="round" />
        {finger(c, -13, 6.5, 27)}
        {finger(c, -6, 6.5, 32)}
        {finger(c, 1, 6.5, 28)}
        {finger(c, 8, 6.5, 21)}
        <path d="M-15 4 Q-21 2 -23 8 Q-23 15 -17 17 L-11 15 Q-14 11 -15 4 Z" fill={c.skin} stroke={c.ink} strokeWidth="2.1" strokeLinejoin="round" />
        <path d="M-7 0 L-7 13 M0 0 L0 14 M7 0 L7 12" stroke={c.skinDark} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </g>
    )}
  </g>
);

const Arm: React.FC<{c: C; side: number; u: number; f: number; grip: number}> = ({c, side, u, f, grip}) => {
  const sx = side * 65;
  const sy = 179;
  const ex = sx + side * Math.sin(rad(u)) * 98;
  const ey = sy + Math.cos(rad(u)) * 98;
  const wx = ex + side * Math.sin(rad(f)) * 86;
  const wy = ey + Math.cos(rad(f)) * 86;
  return (
    <g>
      <path d={`M${sx} ${sy} L${ex} ${ey} L${wx} ${wy}`} fill="none" stroke={c.ink} strokeWidth="40" strokeLinejoin="round" strokeLinecap="round" />
      <path d={`M${sx} ${sy} L${ex} ${ey} L${wx} ${wy}`} fill="none" stroke={c.shirt} strokeWidth="33" strokeLinejoin="round" strokeLinecap="round" />
      <g transform={`translate(${wx} ${wy}) rotate(${-side * f})`}>
        <Hand c={c} side={side} grip={grip} />
        <rect x="-18" y="-10" width="36" height="13" rx="4" fill={c.shirtDark} stroke={c.ink} strokeWidth="3" />
      </g>
    </g>
  );
};

const Shoe: React.FC<{c: C; x: number}> = ({c, x}) => (
  <g transform={`translate(${x} 614)`}>
    <path d="M-19 -18 Q0 -25 19 -18 L24 11 Q24 25 0 27 Q-24 25 -24 11Z" fill={c.shoe} stroke={c.ink} strokeWidth="3.8" />
    <path d="M-22 15 Q0 24 22 15 L23 22 Q0 33 -23 22Z" fill={c.sole} stroke={c.ink} strokeWidth="2.8" />
    <path d="M-9 -8 Q0 -12 9 -8" stroke="#55555c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
  </g>
);

export interface InterpreteProps {
  /** Seconds. */
  t: number;
  variant?: Variant;
  outfit?: 'gilet' | 'giacca';
  hairstyle?: 'coda' | 'corto';
  accessories?: {earrings?: boolean; freckles?: boolean};
  palette: Palette;
  pose: Pose;
  ex?: Expr;
  gaze?: Gaze;
  /** Mouth opening 0..9 (from the voice's energy). */
  mouth?: number;
  /** 0..1. */
  blink?: number;
  /** 0..1: the final bow. */
  thanks?: number;
  /** 0..1: the figure comes alive just before the first verse (still before). */
  live?: number;
  /** Where the figure's origin (its feet's line, ~1000 units high) goes, and its scale. */
  x: number;
  y: number;
  scale?: number;
}

/** Actor or actress: same geometry, same poses, different costume and hair. */
export const Interprete: React.FC<InterpreteProps> = ({t, variant = 'attore', outfit, hairstyle, accessories, palette, pose, ex = EXPR.N, gaze = {x: 0, y: 0, h: 0}, mouth = 0, blink = 0, thanks = 0, live = 1, x, y, scale = 1.2}) => {
  const c = fullPalette(palette, variant);
  const lx = -36;
  const rx = 36;
  // The weight passes slowly from one foot to the other; breathing keeps the figure alive between gestures.
  const sway = (5 * Math.sin((2 * Math.PI * t) / 8.5) + 2 * Math.sin((2 * Math.PI * t) / 13.1)) * live;
  const shift = (pose.lean + sway) * (1 - thanks);
  const breath = Math.sin((2 * Math.PI * t) / 3.6);
  const lk = (lx - 20 + shift - 56) / 2;
  const rk = (rx + 20 + shift + 56) / 2;
  const headRot = pose.head * (1 - thanks) + gaze.h + (1.2 * Math.sin(t * 1.1) + 0.7 * Math.sin(t * 0.53 + 1)) * live + 4 * pose.dip;
  const dipY = 12 * pose.dip;
  const lift = -1.8 * breath;
  const s = scale * (1 + 0.035 * pose.step);
  const brow = (side: number, inner: number, outer: number) => {
    const ox = side * 31;
    const ix = side * 12;
    return `M${ox} ${75 - outer} Q${side * 21} ${71 - (inner + outer) / 2} ${ix} ${74 - inner}`;
  };
  const A = variant === 'attrice';
  const style = hairstyle ?? (A ? 'coda' : 'corto');
  const dress = outfit ?? (A ? 'gilet' : 'giacca');
  const showEarrings = accessories?.earrings ?? A;
  const showFreckles = accessories?.freckles ?? A;
  return (
    <g transform={`translate(${x} ${y + 10 * pose.step}) scale(${s})`}>
      <path d={`M${shift - 56} 335 L${shift + 56} 335 L${rk} 461 L${rx + 21} 603 L${rx - 21} 603 L${rk - 42} 461 L${shift} 403 L${lk + 42} 461 L${lx + 21} 603 L${lx - 21} 603 L${lk} 461Z`} fill={c.trousers} stroke={c.ink} strokeWidth="4" strokeLinejoin="round" />
      <path d={`M${shift} 360 L${shift} 399`} fill="none" stroke="#4a4f58" strokeWidth="3" strokeLinecap="round" />
      <Shoe c={c} x={lx} />
      <Shoe c={c} x={rx} />
      <g transform={`translate(${shift} ${dipY}) rotate(${-2.5 * pose.twist} 0 340)`}>
        <g transform={`translate(0 350) scale(${(1 + 0.01 * thanks + 0.006 * breath) * (1 - 0.07 * pose.twist)} ${(1 - 0.07 * thanks) * (1 + 0.008 * breath)}) translate(0 -350)`}>
          {dress === 'gilet' ? (
            <>
              <path d="M-24 149 Q-45 150 -66 166 L-61 235 L-57 343 Q0 359 57 343 L61 235 L66 166 Q44 150 24 149Z" fill={c.shirt} stroke={c.ink} strokeWidth="4" strokeLinejoin="round" />
              <path d="M-30 154 Q-48 160 -51 181 L-46 338 Q0 351 46 338 L51 181 Q48 160 30 154 L18 153 Q0 184 -18 153Z" fill={c.vest} stroke={c.ink} strokeWidth="3.5" strokeLinejoin="round" />
              <path d="M-38 188 L-34 330 M38 188 L34 330 M-26 294 L26 294" stroke={c.vestLight} strokeWidth="2.4" strokeLinecap="round" opacity=".85" />
              {[226, 267, 308].map((yy) => <circle key={yy} cx="0" cy={yy} r="3.4" fill={c.button} stroke={c.ink} strokeWidth="1.5" />)}
              {[-42, -35, 35, 42].map((xx) => <path key={xx} d={`M${xx} 194 L${xx * 0.82} 329`} stroke={c.vestLight} strokeWidth="1.5" opacity=".5" />)}
              <path d="M-24 137 L-24 161 Q0 179 24 161 L24 137Z" fill={c.skin} stroke={c.ink} strokeWidth="3.5" />
              <path d="M-24 151 Q0 176 24 151" fill="none" stroke="#f49aa0" strokeWidth="5" strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d="M-24 149 Q-45 150 -66 166 L-61 235 L-57 343 Q0 359 57 343 L61 235 L66 166 Q44 150 24 149Z" fill={c.inner} stroke={c.ink} strokeWidth="4" strokeLinejoin="round" />
              <path d="M-22 156 Q-46 156 -58 168 L-56 346 Q-28 355 -3 352 L-3 268Z M22 156 Q46 156 58 168 L56 346 Q28 355 3 352 L3 268Z" fill={c.vest} stroke={c.ink} strokeWidth="3.5" strokeLinejoin="round" />
              <path d="M-48 290 L-26 290 M26 290 L48 290" stroke={c.vestLight} strokeWidth="3" strokeLinecap="round" />
              {[288, 312, 336].map((yy) => <circle key={yy} cx="-10" cy={yy} r="3.4" fill={c.button} stroke={c.ink} strokeWidth="1.5" />)}
              {[-50, -43, -36, -29, 36, 43, 50].map((xx) => <path key={xx} d={`M${xx} 190 L${xx} 338`} stroke={c.vestLight} strokeWidth="1.6" opacity=".55" />)}
              <path d="M-24 137 L-24 154 Q0 177 24 154 L24 137Z" fill={c.skin} stroke={c.ink} strokeWidth="3.5" />
              <path d="M-25 138 L25 138 L28 162 Q0 172 -28 162Z" fill={c.inner} stroke={c.ink} strokeWidth="3.2" strokeLinejoin="round" />
              {[-16, -8, 0, 8, 16].map((xx) => <path key={xx} d={`M${xx} 142 L${xx} 164`} stroke={c.innerDark} strokeWidth="2" />)}
            </>
          )}
          <g transform={`translate(0 ${5 * thanks + lift}) rotate(${headRot} 0 133) translate(0 133) scale(${1 + 0.02 * thanks}) translate(0 -133)`}>
            {style === 'coda' && (
              <>
                <path d="M-51 54 Q-60 9 0 5 Q61 5 52 56 L55 131 Q41 151 24 139 Q13 157 0 143 Q-14 158 -27 140 Q-44 151 -55 130Z" fill={c.hair} stroke={c.ink} strokeWidth="4" />
                <path d="M43 43 Q88 41 97 78 Q104 109 79 134 Q64 149 41 146 Q59 115 44 88Z" fill={c.hair} stroke={c.ink} strokeWidth="4" />
                <path d="M54 61 Q79 64 83 84 M55 85 Q75 93 75 111" fill="none" stroke={c.hairHi} strokeWidth="4" strokeLinecap="round" opacity=".88" />
              </>
            )}
            <ellipse cx="-48" cy="87" rx="10" ry="16" fill={c.skin} stroke={c.ink} strokeWidth="3.4" />
            <ellipse cx="48" cy="87" rx="10" ry="16" fill={c.skin} stroke={c.ink} strokeWidth="3.4" />
            <path d="M-47 54 Q-44 19 0 19 Q44 19 47 54 L45 103 Q38 140 0 144 Q-38 140 -45 103Z" fill={c.skin} stroke={c.ink} strokeWidth="4" />
            <path d="M-45 76 Q-62 39 -35 20 Q-16 5 8 14 Q42 3 52 33 Q59 55 44 76 L36 47 Q14 61 -9 44 Q-22 56 -41 53Z" fill={c.hair} stroke={c.ink} strokeWidth="3.5" strokeLinejoin="round" />
            {style === 'coda' ? (
              <path d="M-34 32 Q-14 14 14 18 M18 16 Q38 18 46 36 M-31 51 Q-17 58 -6 44" stroke={c.hairHi} strokeWidth="4.2" fill="none" strokeLinecap="round" opacity=".9" />
            ) : (
              <path d="M-34 32 Q-14 14 14 18 M18 16 Q38 18 46 36" stroke={c.hairHi} strokeWidth="4.2" fill="none" strokeLinecap="round" opacity=".85" />
            )}
            <path d="M-26 28 Q-12 20 4 22" stroke={c.hairGloss} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".8" />
            <g>
              <path d={`${brow(-1, ex.li, ex.lo)} ${brow(1, ex.ri, ex.ro)}`} stroke={c.ink} strokeWidth="4.2" fill="none" strokeLinecap="round" />
              {blink > 0.6 ? (
                <path d="M-29 87 Q-22 92 -15 87 M15 87 Q22 92 29 87" fill="none" stroke={c.ink} strokeWidth="3.5" strokeLinecap="round" />
              ) : (
                <>
                  <ellipse cx="-22" cy="87" rx="8.5" ry="8.8" fill="#fffaf0" stroke={c.ink} strokeWidth="2.2" />
                  <ellipse cx="22" cy="87" rx="8.5" ry="8.8" fill="#fffaf0" stroke={c.ink} strokeWidth="2.2" />
                  <ellipse cx={-22 + gaze.x} cy={87 + gaze.y} rx="3.9" ry="5" fill={c.ink} />
                  <ellipse cx={22 + gaze.x} cy={87 + gaze.y} rx="3.9" ry="5" fill={c.ink} />
                </>
              )}
              <path d="M1 89 L-4 102 L4 103" fill="none" stroke={c.skinDark} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {mouth > 1 ? (
                <ellipse cx="0" cy="118" rx="10" ry={3 + mouth * 0.55} fill="#7a4636" />
              ) : (
                <path d={`M-12 ${117 - 3.5 * ex.sm} Q0 ${121 + 4 * ex.sm} 12 ${117 - 3.5 * ex.sm}`} stroke={c.lip} strokeWidth="3.5" fill="none" strokeLinecap="round" />
              )}
              {showFreckles && (
                <g fill={c.freckles} opacity=".72"><circle cx="-14" cy="103" r="1.2" /><circle cx="-8" cy="106" r="1.1" /><circle cx="9" cy="105" r="1.1" /><circle cx="15" cy="102" r="1.2" /></g>
              )}
              {showEarrings && (
                <>
                  <circle cx="-49" cy="111" r="5" fill="#e8b03d" stroke={c.ink} strokeWidth="2.2" />
                  <circle cx="49" cy="111" r="5" fill="#e8b03d" stroke={c.ink} strokeWidth="2.2" />
                </>
              )}
            </g>
          </g>
        </g>
        <g transform={`translate(0 ${lift * 0.6})`}>
          <Arm c={c} side={-1} u={mix(pose.lu, 3, thanks)} f={mix(pose.lf, 2, thanks)} grip={pose.grip} />
          <Arm c={c} side={1} u={mix(pose.ru, 3, thanks)} f={mix(pose.rf, 2, thanks)} grip={pose.grip} />
        </g>
      </g>
    </g>
  );
};
