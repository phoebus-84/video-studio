// word-tracks@1.0.0 — released: never edit this file; add word-tracks/<next>.tsx instead.
// A poem's shape at a glance (from CreativeStudio's poesie-museo-long note on
// the text): one track per verse, one pill per word as long as the word,
// punctuation as light — a comma one dot, a semicolon or a colon two, a full
// stop that glows and rings. A cursor reads the tracks; then they merge into a
// single line, one sentence. Channel-neutral: the look is a prop (ADR-0040).
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {clamp, ease, ramp} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import type {Box} from '../lib/lesson-stage/1.0.0.js';

const WordTracks: KitVersion['component'] = ({props}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = props.look as Look;
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? {x: 440, y: 150, w: 1060, h: 596};
  const lines = props.lines as string[];
  const [readFrom, readTo] = props.read as [number, number];
  const point = props.point as number | undefined;
  const merge = props.merge as number | undefined;
  const rows = lines.map((line) => line.split(/\s+/).filter(Boolean).map((tok) => ({len: Math.max(1, tok.replace(/[^\p{L}'’]/gu, '').length), p: /[,;:.!?]$/u.exec(tok)?.[0] ?? ''})));
  const U = 14;
  const GAP = 9;
  const X0 = P.x + 70;
  const Y0 = P.y + 92;
  const DY = Math.min(66, (P.h - 140) / Math.max(1, rows.length - 1));
  const H = 24;
  const rowW = rows.map((r) => r.reduce((s, x) => s + x.len * U + GAP + (x.p ? 16 : 0), 0));
  const total = rowW.reduce((s, x) => s + x, 0);
  // merged, the whole poem fits one line inside the panel
  const S = Math.min(1, (P.w - 140) / total);
  const m = merge === undefined ? 0 : ease((t - merge + 0.1) / 1.1);
  const read = clamp((t - readFrom) / Math.max(0.5, readTo - readFrom)) * rows.length;
  const dim = point === undefined ? 0 : ramp(t, point, point + 0.4);
  let acc = 0;
  const pills = rows.flatMap((r, i) => {
    let x = 0;
    const base = acc;
    acc += rowW[i]!;
    return r.map((tok, j) => {
      const x0 = X0 + x;
      const y0 = Y0 + i * DY;
      const xf = X0 + (base + x) * S;
      const yf = Y0 + Math.min(3, rows.length - 1) * DY;
      const px = x0 + (xf - x0) * m;
      const py = y0 + (yf - y0) * m;
      const pw = tok.len * U * (1 + (S - 1) * m);
      const lit = clamp(read - i - j / r.length) > 0;
      const last = i === rows.length - 1 && j === r.length - 1;
      x += tok.len * U + GAP + (tok.p ? 16 : 0);
      return {key: `${i}-${j}`, px, py, pw, lit, p: tok.p, last, show: ramp(t, 0.1 + i * 0.06, 0.4 + i * 0.06)};
    });
  });
  const cursorRow = Math.min(rows.length - 1, Math.floor(read));
  const cursorK = read - Math.floor(read);
  const scale = 1 + (S - 1) * m;
  return (
    <AbsoluteFill>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <defs>
          <linearGradient id={`${id}lit`} x1="0" x2="1"><stop offset="0" stopColor={c.glow} /><stop offset="1" stopColor={c.accent} /></linearGradient>
          <filter id={`${id}g`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {pills.map(({key, px, py, pw, lit, p, last, show}) => (
          <g key={key} opacity={show * (last ? 1 : 1 - 0.6 * dim)}>
            <rect x={px} y={py - H / 2} width={Math.max(4, pw)} height={H} rx={H / 2} fill={lit ? `url(#${id}lit)` : alpha(c.text, 0.18)} stroke={alpha(c.text, 0.35)} strokeWidth="1" />
            {p === ',' ? <circle cx={px + pw + 8 * scale} cy={py + 6} r={5} fill={c.lightning} /> : null}
            {p === ';' || p === ':' ? <g fill={c.lightning}><circle cx={px + pw + 8} cy={py - 5} r={4.5} /><circle cx={px + pw + 8} cy={py + 7} r={4.5} /></g> : null}
            {p === '.' || p === '!' || p === '?' ? (
              <g>
                <circle cx={px + pw + 12} cy={py + 4} r={8 + 4 * dim} fill={c.highlight} filter={`url(#${id}g)`} />
                {point !== undefined && t > point ? [0, 1].map((k) => {
                  const ph = ((t - point) * 0.8 + k * 0.5) % 1;
                  return <circle key={k} cx={px + pw + 12} cy={py + 4} r={10 + 50 * ph} fill="none" stroke={c.highlight} strokeWidth="2" opacity={(1 - ph) * 0.8} />;
                }) : null}
              </g>
            ) : null}
          </g>
        ))}
        {read < rows.length && read > 0 ? <rect x={X0 - 8 + cursorK * rowW[cursorRow]! - 3} y={Y0 + cursorRow * DY - 24} width={6} height={48} rx={3} fill="#fff" filter={`url(#${id}g)`} /> : null}
      </svg>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'word-tracks',
  version: '1.0.0',
  description: "A poem's shape in a 16:9 panel: one track per verse, one pill per word, punctuation as light, a cursor that reads, the tracks merging into one sentence, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    /** The verses, as written: words by spaces, punctuation kept. */
    lines: z.array(z.string().min(1).max(120)).min(1).max(8),
    /** The cursor reads the tracks from the first instant to the second. */
    read: z.tuple([z.number(), z.number()]).refine(([a, b]) => b > a, {message: 'the cursor reads forward'}),
    /** The full stop glows and rings from here. */
    point: z.number().optional(),
    /** The tracks merge into one line from here. */
    merge: z.number().optional(),
  }).strict(),
  component: WordTracks,
  examples: ((): KitExample[] => {
    const lines = ['And sky and earth showed what they were:', 'the earth gasping, livid, in turmoil;', 'the sky cluttered, tragic, worn;', 'white, white in the silent tumult', 'a house appeared, vanished in a flash;', 'like an eye, wide open, startled,', 'that opened and closed, in the black night.'];
    return [
      {id: 'reading', props: {look: DEMO_LOOK, lines, read: [0, 3]}, durationInFrames: 150, frame: 50},
      {id: 'full-stop', props: {look: DEMO_LOOK, lines, read: [0, 2], point: 2.2}, durationInFrames: 150, frame: 90},
      {id: 'one-sentence', props: {look: DEMO_LOOK, lines, read: [0, 2], point: 2.2, merge: 3}, durationInFrames: 150, frame: 140},
    ];
  })(),
};
