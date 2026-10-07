// look@1.0.0 — released: never edit this file; add look/<next>.ts instead (ADR-0039, ADR-0040).
// The vocabulary a channel-neutral kit draws with: colour roles, font roles
// and a few shared measures. A channel theme (studio contracts, ChannelTheme)
// carries the same shape as data; the compiler passes it through untouched.

import type {CSSProperties} from 'react';
import {z} from 'zod';

const color = z.string().regex(/^(#[0-9a-fA-F]{6}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\))$/, 'a colour is #rrggbb or rgba(r, g, b, a)');

export const COLOR_ROLES = ['ink', 'text', 'textDim', 'accent', 'highlight', 'glow', 'lightning', 'plate', 'plateLine', 'shadow', 'backdrop', 'signal'] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export const LookSchema = z.object({
  /**
   * ink: dark text on light; text, textDim: light text; accent: kickers, rules, glows;
   * highlight: said and strong words, marks; glow: soft light; lightning: bolts;
   * plate, plateLine: dark plates and their edge; shadow; backdrop: full-frame
   * dark grounds; signal: a warning colour.
   */
  colors: z.object(Object.fromEntries(COLOR_ROLES.map((r) => [r, color])) as Record<ColorRole, typeof color>).strict(),
  /** Families among the bundled faces (fonts@1.1.0); weights are the kits'. */
  fonts: z.object({display: z.string().min(1), serif: z.string().min(1), sans: z.string().min(1)}).strict(),
  measures: z.object({plateRadius: z.number().min(0).max(64), textShadow: z.string().min(1).max(200), minTextPx: z.number().min(10).max(80)}).strict(),
}).strict();
export type Look = z.infer<typeof LookSchema>;

/** A full dark plate: fill, edge, shadow and the accent's inset line on top. */
export const plateStyle = (look: Look, accentLine = true): CSSProperties => ({
  background: look.colors.plate,
  border: `1px solid ${look.colors.plateLine}`,
  borderRadius: look.measures.plateRadius,
  // a short shadow: plates sit near the safe zone's edge, and the zone counts every pixel drawn
  boxShadow: `0 10px 24px ${look.colors.shadow}${accentLine ? `, inset 0 2px 0 ${look.colors.accent}` : ''}`,
});

/** A colour of the look at opacity `a` (multiplied into an rgba colour's own). */
export const alpha = (c: string, a: number): string => {
  const hex = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(c);
  if (hex) return `rgba(${parseInt(hex[1]!, 16)},${parseInt(hex[2]!, 16)},${parseInt(hex[3]!, 16)},${+a.toFixed(3)})`;
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(c);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${+(parseFloat(m[4]!) * a).toFixed(3)})` : c;
};

/** A size never under the look's minimum for text. */
export const textPx = (look: Look, px: number): number => Math.max(px, look.measures.minTextPx);

/** A demo look with no channel in it, for kit examples and previews. */
export const DEMO_LOOK: Look = {
  colors: {
    ink: '#1b1d24', text: '#f4f5f7', textDim: 'rgba(244,245,247,.85)', accent: '#4f9dff', highlight: '#ffd166', glow: '#cfe3ff',
    lightning: '#c9c3ff', plate: 'rgba(20,22,30,.86)', plateLine: 'rgba(255,255,255,.4)', shadow: 'rgba(0,0,0,.4)', backdrop: '#14161e', signal: '#ff5d6c',
  },
  fonts: {display: 'Anton', serif: 'Fraunces', sans: 'Inter'},
  measures: {plateRadius: 12, textShadow: '0 2px 3px rgba(0,0,0,.8), 0 0 14px rgba(0,0,0,.5)', minTextPx: 26},
};
