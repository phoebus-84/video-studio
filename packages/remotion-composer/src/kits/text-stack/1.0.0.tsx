// text-stack@1.0.0 — released: never edit this file; add text-stack/<next>.tsx instead.
// A column of texts over a lesson's panel: big numbers and years, titles,
// chips, quotes, kickers and notes, rows of them and spaces, each arriving at
// its time and leaving at its own. Every item holds its room from the start
// (only its opacity changes), so nothing ever overlaps; titles, quotes and
// notes sit on full plates (from CreativeStudio's poesie-museo-long HStack and
// HItem). Channel-neutral: the look is a prop (ADR-0040).
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type ColorRole, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import type {Face} from '../lib/font-metrics/1.0.0.js';
import {TEXT_ROLES, fitLine} from '../lib/lesson-tools/1.0.0.js';
import {clamp, ease} from '../lib/stage-math/1.0.0.js';

type Kind = 'big' | 'year' | 'title' | 'chip' | 'quote' | 'kicker' | 'note';
interface TextItem {kind: Kind; text: string; at: number; until?: number; size?: number; color?: ColorRole; wrap?: boolean}
type Item = TextItem | {row: Item[]; gap?: number} | {space: number};

const SIZES: Record<Kind, number> = {big: 110, year: 110, title: 64, chip: 32, quote: 50, kicker: 26, note: 30};

const TextStack: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const width = (props.width as number | undefined) ?? 900;
  const align = (props.align as 'left' | 'center' | 'right' | undefined) ?? 'left';
  const x = props.x as number;
  const y = props.y as number;
  const fromBottom = props.bottom === true;
  const faceOf = (kind: Kind): Face => kind === 'big' || kind === 'year' || kind === 'title' ? {family: look.fonts.display, weight: 400}
    : kind === 'quote' ? {family: look.fonts.serif, weight: 400, style: 'italic'} : {family: look.fonts.sans, weight: kind === 'note' ? 400 : 600};

  const textItem = (it: TextItem, key: React.Key, room: number) => {
    const k = ease((t - it.at) / 0.55);
    const op = clamp((t - it.at) / 0.3) * (1 - clamp((t - (it.until ?? 1e9)) / 0.35));
    const nominal = it.size ?? SIZES[it.kind];
    // a line that does not wrap is sized to the stack's width, its letter spacing and its plate's padding included
    const ls = it.kind === 'kicker' ? 6 : it.kind === 'quote' || it.kind === 'note' ? 0 : 2;
    // a chip: its padding and border; a plate: its padding (.32em each side) and its shadow (24 px each side)
    const pad = (s: number) => (it.kind === 'kicker' ? 0 : it.kind === 'chip' ? 42 : s * 0.64 + 48);
    const size = it.wrap ? nominal : fitLine(faceOf(it.kind), [it.text], room, nominal, () => ls, pad);
    const base: React.CSSProperties = {opacity: op, transform: `translateY(${(1 - k) * 14}px)`, textShadow: look.measures.textShadow, whiteSpace: it.wrap ? 'normal' : 'nowrap', lineHeight: 1.08, color: c[it.color ?? 'text']};
    const plate: React.CSSProperties = {display: 'inline-block', padding: '.12em .32em .16em', borderRadius: look.measures.plateRadius - 2, background: alpha(c.plate, 0.85), boxShadow: `0 10px 24px ${c.shadow}`};
    switch (it.kind) {
      case 'big':
      case 'year':
        return <div key={key} style={{...base, ...plate, fontFamily: fonts.display, fontSize: size, letterSpacing: (1 - k) * 10 + 2, lineHeight: 0.95}}>{it.text}</div>;
      case 'title':
        return <div key={key} style={{...base, ...plate, fontFamily: fonts.display, fontSize: size, letterSpacing: 2}}>{it.text}</div>;
      case 'kicker':
        return <div key={key} style={{...base, fontFamily: fonts.sans, fontWeight: 600, fontSize: size, letterSpacing: 6, color: c[it.color ?? 'accent']}}>{it.text}</div>;
      case 'quote':
        return <div key={key} style={{...base, ...plate, fontFamily: fonts.serif, fontStyle: 'italic', fontSize: size, lineHeight: 1.2}}>{it.text}</div>;
      case 'note':
        return <div key={key} style={{...base, ...plate, fontFamily: fonts.sans, fontWeight: 400, fontSize: size, lineHeight: 1.3}}>{it.text}</div>;
      default:
        return (
          <div key={key} style={{...base, display: 'inline-block', fontFamily: fonts.sans, fontWeight: 600, fontSize: size, letterSpacing: 2, padding: '10px 20px 11px', borderRadius: 10,
            background: alpha(c.plate, 0.95), border: `1px solid ${c.plateLine}`, boxShadow: `inset 0 2px 0 ${c.accent}`, color: c[it.color ?? 'glow'], textShadow: 'none'}}>{it.text}</div>
        );
    }
  };
  const item = (it: Item, key: React.Key, room: number): React.ReactNode => {
    if ('space' in it) return <div key={key} style={{height: it.space}} />;
    if ('row' in it) {
      const gap = it.gap ?? 16;
      const share = (room - gap * (it.row.length - 1)) / it.row.length;
      return <div key={key} style={{display: 'flex', gap, alignItems: 'baseline'}}>{it.row.map((x2, j) => item(x2, j, share))}</div>;
    }
    return textItem(it, key, room);
  };
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  return (
    <div style={{position: 'absolute', left, ...(fromBottom ? {bottom: 1080 - y} : {top: y}), width, display: 'flex', flexDirection: 'column', gap: (props.gap as number | undefined) ?? 16,
      alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', textAlign: align}}>
      {(props.items as Item[]).map((it, i) => item(it, i, width))}
    </div>
  );
};

const Role = z.enum(TEXT_ROLES);
const TextItemSchema = z.object({
  kind: z.enum(['big', 'year', 'title', 'chip', 'quote', 'kicker', 'note']),
  text: z.string().min(1).max(200),
  at: z.number(),
  until: z.number().optional(),
  size: z.number().positive().max(240).optional(),
  color: Role.optional(),
  /** Wrap onto several lines (notes, quotes) instead of fitting one line to the width. */
  wrap: z.boolean().optional(),
}).strict().refine((it) => it.until === undefined || it.until > it.at, {message: 'an item leaves after it arrives', path: ['until']});
const ItemSchema: z.ZodType<Item> = z.lazy(() => z.union([
  TextItemSchema,
  z.object({row: z.array(ItemSchema).min(1).max(6), gap: z.number().min(0).optional()}).strict(),
  z.object({space: z.number().min(0).max(400)}).strict(),
]));

export const kit: KitVersion = {
  name: 'text-stack',
  version: '1.0.0',
  description: "A column of a lesson's texts — big numbers and years, titles, chips, quotes, kickers, notes, rows and spaces — each arriving and leaving at its time without ever overlapping, on full plates, in the channel theme's look.",
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** The stack's left edge (align left), centre (center) or right edge (right). */
    x: z.number(),
    /** Its top, or its bottom when `bottom` is true. */
    y: z.number(),
    bottom: z.boolean().optional(),
    width: z.number().positive().max(1728).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    gap: z.number().min(0).optional(),
    items: z.array(ItemSchema).min(1).max(12),
  }).strict(),
  component: TextStack,
  examples: [
    {id: 'story', props: {look: DEMO_LOOK, x: 520, y: 240, items: [
      {kind: 'kicker', text: 'A POOR COUNTRY', at: 0},
      {kind: 'year', text: '1861 → 1894', at: 0.3},
      {kind: 'note', text: 'more than one Italian in two can neither read nor write', at: 0.8, wrap: true},
      {kind: 'chip', text: 'EMIGRATION', at: 1.2},
    ]}, durationInFrames: 90, frame: 60},
    {id: 'counts', props: {look: DEMO_LOOK, x: 1430, y: 220, width: 440, align: 'right', gap: 22, items: [
      {row: [{kind: 'big', text: '7', at: 0, size: 120}, {kind: 'kicker', text: 'VERSES', at: 0.1, size: 34}]},
      {row: [{kind: 'big', text: '1', at: 0.4, size: 120, color: 'highlight'}, {kind: 'kicker', text: 'FULL STOP', at: 0.5, size: 34, color: 'highlight'}]},
      {row: [{kind: 'big', text: '1', at: 0.8, size: 120}, {kind: 'kicker', text: 'SENTENCE', at: 0.9, size: 34}]},
    ]}, durationInFrames: 90, frame: 60},
    {id: 'quote-arriving', props: {look: DEMO_LOOK, x: 960, y: 300, align: 'center', items: [
      {kind: 'kicker', text: 'AN UNPUBLISHED PREFACE', at: 0},
      {kind: 'quote', text: 'like a flash in a dark night', at: 0.6},
      {kind: 'title', text: 'THAT REVEALS EVERYTHING', at: 1.2, color: 'highlight'},
    ]}, durationInFrames: 60, frame: 25},
    {id: 'long', props: {look: DEMO_LOOK, x: 520, y: 260, width: 860, items: [
      {kind: 'title', text: 'A TITLE FAR TOO LONG FOR ITS STACK AT SIXTY-FOUR PX', at: 0},
      {kind: 'chip', text: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM', at: 0},
    ]}, durationInFrames: 30, frame: 20},
  ],
};
