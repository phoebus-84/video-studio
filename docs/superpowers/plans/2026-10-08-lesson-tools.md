# The Lesson's Teaching Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-dcf.4.2` (`avg-dcf.4.2.1` and `avg-dcf.4.2.2`). The long lesson's teaching becomes sixteen channel-neutral 16:9 kits that take the theme's `look`, drawn with one new frozen library:
- the narrative tools: `panel@1.1.0`, `text-stack`, `timeline`, `story-fx`, `word-tracks`, `interlinear`, `monitor-wall`, `summary`, `progress`;
- the figure tools: `merge`, `cards`, `stack`, `oxymoron`, `simile`;
- the metre: `syllables`, `rhymes`.

**Architecture:**
- `lib/lesson-tools/1.0.0.tsx` holds what several tools draw with: chips, tags, lighting titles, SVG text, waves, eyelids, the living iris, shards, wind, smoke, lines of light. It also holds `coverPoint` (a picture's point once framed), `fitLine` (a line fitted with its plate) and the figure tools' `PictureSchema`.
- Every kit is `1.0.0` (the panel `1.1.0`), drawn for `youtube-1920x1080`, takes `look: LookSchema`, gives its times in seconds from the item's start, and takes every text as a prop. Its examples use `DEMO_LOOK`.
- Narrative tools are layers the compiler places. The figure tools and the metre kits draw their own glass panel (default box 440/150/1060×596).
- `@studio/series`' alignment test feeds every theme's look through every neutral kit's examples, so the sixteen are held to the contract automatically.

**Tech Stack:** TypeScript, React 19, Remotion 4.0.505 and zod kits (`node:test` with real frames); `@studio/series` (`node:test`).

**Spec:** `docs/superpowers/specs/2026-10-08-lesson-tools-design.md`, on this branch, updated with what prototyping settled.

Every line of code below was run in a scratch worktree before this plan was written. That prototype is the local commit `d555e4d` on branch `scratch/tools`; never push it, never merge it. What was run there:
- **Suites:** composer 392 tests (one real frame of every example and the safe-zone check included), series 138.
- **Checks:** typecheck, `check:boundaries`, `check:contracts`, `check:pipelines`, `docs:check`.
- **The look:** the tools rendered with the Dentro i versi theme beside thirteen moments of CreativeStudio's delivered Il lampo long.

Generated files (previews) are taken with `git -C "$(git rev-parse --show-toplevel)" checkout d555e4d -- <paths>`.

## Global Constraints

- Work on branch `feat/lesson-tools`, in the main checkout (not a worktree). It holds the spec commits.
- Never push or merge without the user's go.
- Leave the checkout's unrelated changes alone: `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts`, `studio/gateway/test/workspace-filesystem.test.ts`. Never stage them; never run `bd`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use `git add` with explicit paths only.
- Code goes in exactly as shown. Where a step shows a diff, the file must end up exactly as the diff says.
- **Released kits and library modules never change.** Each new lock entry is written once, by `npm run kits:lock`, and must equal the value given in its task. If it doesn't, fix the file, never the lock. No existing entry may change.
- No dependency changes. No contract changes.
- Libraries read no environment variable.
- `@studio/series` consumes the composer through `dist/`: run `npm run build --workspace @av/remotion-composer` before its tests.
- The composer may not import the contracts (`npm run check:boundaries`).
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.
- The short's kits are not migrated here (`avg-d1x`); do not touch them. The science bridge and sounds are out of scope.

## Review Focus

- **Texts longer than the examples' typical ones.** Every single line must be fitted to its room, its plate included, and never wrapped, overflowed or shrunk below the look's `minTextPx` past its box. Each kit has a long-text example where text is fitted (`text-stack` long, `cards` long, the panel's split labels). The one-frame tests and the safe-zone check pin them; `fitLine` is pinned in Task 1.
- **Points on pictures of another shape.** The glow on the house and the iris must land on the point named, whatever the picture's aspect, focus and zoom. Task 1's `coverPoint` tests pin this.
- **Times out of order, or indices that point nowhere.** These must be refused at their paths: a cursor reading backwards, a struck word or rhyme pair outside the list, a merge joining syllables that are not neighbours, a tool's times in the wrong order. Tasks 2–4's refusal tests pin this.
- **Overlays at the edge of the 16:9 safe zone.** `text-stack`, `interlinear` and `progress` are overlays: every pixel must stay inside, shadows included. The one-frame tests pin this.
- **A channel's look the kits refuse.** Every theme's look must draw in all sixteen. Task 5's alignment test pins this.

---

### Task 1: The teaching tools' library

**Files:**
- Create:
  - `packages/remotion-composer/src/kits/lib/lesson-tools/1.0.0.tsx`;
  - `packages/remotion-composer/test/lesson-tools.test.ts`.

**Interfaces:**
- Consumes:
  - `lib/look/1.0.0.ts`: `Look`, `ColorRole`, `alpha`;
  - `lib/stage-math/1.0.0.ts`: `clamp`, `ease`, `rnd`;
  - `lib/lesson-stage/1.0.0.tsx`: `Cover`, `Box`, `Point`, `ptsPath`;
  - `lib/stage-props/1.0.0.ts`: `AssetUrl`;
  - `lib/font-metrics/1.0.0.ts`: `textWidth`, `Face`.
- Produces:
  - `Families`, `roleColor`, `back`;
  - `SvgText`, `GlassChip`, `Tag`, `LightTitle`;
  - `wavePath`, `Eyelids`, `IrisLive`, `Shards`, `Wind`, `Smoke`, `LightLine`;
  - `coverPoint(box, imgW, imgH, cx, cy, zoom, px, py): Point`;
  - `fitLine(face, lines, width, max, ls?, pad?): number`;
  - `PictureSchema`, `Picture`, `PANEL`;
  - a re-export of `ptsPath`.

- [ ] **Step 1: Write the failing test**

Create `packages/remotion-composer/test/lesson-tools.test.ts`:

````ts
// What the teaching tools place and fit with (lib/lesson-tools): points on a framed picture, lines on plates.
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {textWidth} from '../src/kits/lib/font-metrics/1.0.0.js';
import {coverPoint, fitLine} from '../src/kits/lib/lesson-tools/1.0.0.js';

const near = (a: readonly number[], b: readonly number[]) => a.every((x, i) => Math.abs(x - b[i]!) < 1e-6);

describe('coverPoint', () => {
  const box = {x: 100, y: 50, w: 1000, h: 500};
  it('maps a picture of the box\'s own aspect onto the box', () => {
    assert.ok(near(coverPoint(box, 2, 1, 0.5, 0.5, 1, 0, 0), [100, 50]));
    assert.ok(near(coverPoint(box, 2, 1, 0.5, 0.5, 1, 1, 1), [1100, 550]));
  });
  it('crops a taller picture around its focus: the focus point stays where object-position puts it', () => {
    // a 4:3 picture covering a 2:1 box is 1000×750: 250 px are cropped, shared by the focus
    assert.ok(near(coverPoint(box, 4, 3, 0.5, 0, 1, 0.5, 0), [600, 50]));
    assert.ok(near(coverPoint(box, 4, 3, 0.5, 1, 1, 0.5, 1), [600, 550]));
    assert.ok(near(coverPoint(box, 4, 3, 0.5, 0.5, 1, 0.5, 0.5), [600, 300]));
  });
  it('zooms about the focus: the focus stays put, other points move away from it', () => {
    assert.ok(near(coverPoint(box, 4, 3, 0.3, 0.4, 2, 0.3, 0.4), coverPoint(box, 4, 3, 0.3, 0.4, 1, 0.3, 0.4)));
    const [x1] = coverPoint(box, 4, 3, 0.5, 0.5, 1, 0.6, 0.5);
    const [x2] = coverPoint(box, 4, 3, 0.5, 0.5, 2, 0.6, 0.5);
    assert.ok(Math.abs(x2 - 600 - 2 * (x1 - 600)) < 1e-6);
  });
});

describe('fitLine', () => {
  const face = {family: 'Anton', weight: 400};
  it('keeps the size that fits', () => {
    assert.equal(fitLine(face, ['SKY'], 1000, 64), 64);
  });
  it('shrinks a line until it fits with its spacing and its plate', () => {
    const line = 'A TITLE FAR TOO LONG FOR ITS ROOM';
    const size = fitLine(face, [line], 600, 64, () => 2, (s) => s * 0.64 + 48);
    assert.ok(size < 64);
    assert.ok(textWidth(face, line, size, 2) + size * 0.64 + 48 <= 600);
    assert.ok(textWidth(face, line, size + 0.5, 2) + (size + 0.5) * 0.64 + 48 > 600);
  });
  it('fits every line given', () => {
    const size = fitLine(face, ['SHORT', 'A MUCH LONGER LINE OF TEXT'], 300, 64);
    assert.ok(textWidth(face, 'A MUCH LONGER LINE OF TEXT', size) <= 300);
  });
});
````

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd packages/remotion-composer && node --import tsx --test test/lesson-tools.test.ts`
Expected: FAIL — `Cannot find module '…/src/kits/lib/lesson-tools/1.0.0.js'`.

- [ ] **Step 3: The library**

Create `packages/remotion-composer/src/kits/lib/lesson-tools/1.0.0.tsx`:

````tsx
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

/** SVG text with a dark outline under light colours, never under the look's minimum size. */
export const SvgText: React.FC<{
  look: Look; fonts: Families; x: number; y: number; size: number; children: React.ReactNode;
  role?: 'display' | 'serif' | 'sans'; color?: string; anchor?: 'start' | 'middle' | 'end'; op?: number; weight?: number; ls?: number; italic?: boolean;
}> = ({look, fonts, x, y, size, children, role = 'sans', color, anchor = 'start', op = 1, weight = 400, ls = 0, italic = false}) => {
  const fill = color ?? look.colors.text;
  const px = Math.max(size, look.measures.minTextPx);
  const dark = fill === look.colors.ink;
  return (
    <text x={x} y={y} fontSize={px} fontFamily={fonts[role]} fill={fill} textAnchor={anchor} opacity={op} fontWeight={weight} letterSpacing={ls} fontStyle={italic ? 'italic' : undefined}
      {...(dark ? {} : {stroke: alpha(look.colors.shadow, 1), strokeWidth: Math.max(2.5, px * 0.07), paintOrder: 'stroke', strokeLinejoin: 'round'})}>{children}</text>
  );
};

/** A chip of text on dark glass with an accent line on top, and an optional second line. */
export const GlassChip: React.FC<{look: Look; fonts: Families; x: number; y: number; text: string; op?: number; size?: number; color?: string; anchor?: 'start' | 'middle'; sub?: string}> =
  ({look, fonts, x, y, text, op = 1, size = 34, color, anchor = 'middle', sub}) => {
    if (op <= 0) return null;
    const subSize = Math.max(look.measures.minTextPx, size * 0.55);
    const w = Math.max(text.length * size * 0.66, (sub?.length ?? 0) * subSize * 0.62) + size * 1.6;
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
      return <ellipse key={`l${i}`} cx={x} cy={y} rx={14} ry={6} fill={i % 2 ? '#7fae6a' : '#b8a35a'} transform={`rotate(${(t * 360 * (1 + rnd(i))) % 360} ${x} ${y})`} opacity=".85" />;
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

/** The panel's default box in a 16:9 frame. */
export const PANEL: Box = {x: 440, y: 150, w: 1060, h: 596};

export {ptsPath};
````

- [ ] **Step 4: Run it to make sure it passes, then typecheck**

Run: `node --import tsx --test test/lesson-tools.test.ts`
Expected: PASS, 6 tests.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/remotion-composer/src/kits/lib/lesson-tools/1.0.0.tsx packages/remotion-composer/test/lesson-tools.test.ts
git commit -m "lesson-tools@1.0.0: what the lesson's teaching tools draw, place and fit with (avg-dcf.4.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The narrative tools (avg-dcf.4.2.1)

**Files:**
- Create: the nine kits below, and their nine `previews/*.youtube-1920x1080.png`.
- Modify: `packages/remotion-composer/src/kits/index.ts`, `test/validate.test.ts`, `kits.lock.json`.

**Interfaces:**
- Consumes: Task 1's library; `lib/look`, `lib/fonts/1.1.0.ts` (`useLookFonts`), `lib/font-metrics` (`fitSize`, `textWidth`), `lib/stage-math`, `lib/stage-props`, `lib/lesson-stage`.
- Produces: the kits `panel@1.1.0`, `text-stack@1.0.0`, `timeline@1.0.0`, `story-fx@1.0.0`, `word-tracks@1.0.0`, `interlinear@1.0.0`, `monitor-wall@1.0.0`, `summary@1.0.0`, `progress@1.0.0`.

- [ ] **Step 1: Write the failing tests**

In `packages/remotion-composer/test/validate.test.ts`:

1. Add before "refuses a 16:9 lesson kit in a 9:16 timeline" (with a blank line after it):

```ts
  it('refuses malformed teaching tools at their paths', () => {
    const doc = clone(fixture('explainer.json'));
    const item = doc.tracks[0].items[0];
    const pic = {src: {$asset: 'scene-01-woods'}};
    const look = clone(DEMO_LOOK);
    const refused = (name: string, props: Record<string, unknown>, version = '1.0.0') => {
      item.kit = {name, version};
      item.props = {look, ...props};
      return problems(doc);
    };
    const at = (path: string) => [['bad-props', `$.tracks[0].items[0].props.${path}`]];
    assert.deepEqual(refused('panel', {phases: [{at: 0, layers: [{split: {items: [pic]}}]}]}, '1.1.0'), at('phases[0].layers[0].split.items'));
    assert.deepEqual(refused('text-stack', {x: 0, y: 0, items: [{kind: 'title', text: 'A', at: 0, color: 'red'}]}), at('items[0]'));
    assert.deepEqual(refused('word-tracks', {lines: ['a b.'], read: [2, 1]}), at('read'));
    assert.deepEqual(refused('interlinear', {x: 960, y: 300, width: 900, words: [{text: 'Non', gloss: 'not', at: 0, glossAt: 1}], strike: {indices: [1], at: 2}}), at('strike.indices'));
    assert.deepEqual(refused('monitor-wall', {cells: []}), at('cells'));
    const row = {...pic, keyword: 'K', figure: 'F', at: 0};
    assert.deepEqual(refused('summary', {rows: Array.from({length: 9}, () => row)}), at('rows'));
  });
```

2. In "lists every kit version with what the catalog needs", make the listing:

```ts
    assert.deepEqual(listKits(ids).map((k) => [k.name, k.version, k.layer]), [
      ['block-title', '1.0.0', 'overlay'],
      ['brand-mark', '1.0.0', 'overlay'],
      ['brand-mark', '2.0.0', 'overlay'],
      ['captions', '1.0.0', 'fill'],
      ['captions', '1.1.0', 'overlay'],
      ['chapter-opener', '1.0.0', 'fill'],
      ['clip', '1.0.0', 'fill'],
      ['cover', '1.0.0', 'fill'],
      ['figure-title', '1.0.0', 'overlay'],
      ['interlinear', '1.0.0', 'overlay'],
      ['interprete', '1.0.0', 'fill'],
      ['interprete', '1.1.0', 'fill'],
      ['lower-third', '1.0.0', 'overlay'],
      ['monitor-wall', '1.0.0', 'fill'],
      ['museum-hall', '1.0.0', 'fill'],
      ['panel', '1.0.0', 'fill'],
      ['panel', '1.1.0', 'fill'],
      ['progress', '1.0.0', 'overlay'],
      ['room', '1.0.0', 'fill'],
      ['room-effect', '1.0.0', 'fill'],
      ['still', '1.0.0', 'fill'],
      ['story-fx', '1.0.0', 'fill'],
      ['summary', '1.0.0', 'fill'],
      ['text-stack', '1.0.0', 'overlay'],
      ['timeline', '1.0.0', 'fill'],
      ['title-chip', '1.0.0', 'overlay'],
      ['verse-bar', '1.0.0', 'overlay'],
      ['verse-plate', '1.0.0', 'overlay'],
      ['warp', '1.0.0', 'fill'],
      ['word-tracks', '1.0.0', 'fill'],
    ]);
```

Run: `cd packages/remotion-composer && node --import tsx --test test/validate.test.ts`
Expected: FAIL (the kits do not exist: `unknown-kit`, and the listing differs).

- [ ] **Step 2: The kits**

Create `packages/remotion-composer/src/kits/panel/1.1.0.tsx`:

````tsx
// panel@1.1.0 — released: never edit this file; add panel/<next>.tsx instead.
// The glass panel of a 16:9 lesson and what it shows, phase by phase, as a
// stack of layers (from CreativeStudio's poesie-museo-long story scenes): a
// picture framed on its focus with a slow push, pictures side by side, a
// clip, a grid of light, a darkening, a portrait beside a dark grid, a framed
// picture over the others; each may be shaded and dimmed. Between phases the
// glass turns on itself and the content changes halfway through the turn; it
// materialises with a scan line, its edge lights up with a flash, and a
// discreet credit sits in its corner. Texts are other items: the compiler
// hides them during a turn. Channel-neutral: the look is a prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {clamp, ease, ramp} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema, CameraSchema, cameraStyle, type Camera} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LoopClip, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';

type Focus = [number, number];
type Shade = 'left' | 'left-strong' | 'quote' | 'storm' | number;
interface Common {shade?: Shade; dim?: {at: number; amount: number}}
type Layer = Common & (
  | {picture: {src: string; focus?: Focus; zoom?: number; push?: number}}
  | {split: {items: {src: string; focus?: Focus; at?: number; label?: string}[]; gap?: number; sign?: string}}
  | {clip: {src: string; live?: [number, number]; push?: number}}
  | {grid: {at?: Focus}}
  | {dark: {amount: number}}
  | {portrait: {src: string; width?: number; focusY?: number; dark?: number}}
  | {framed: {src: string; box?: Box; at?: number; focus?: Focus; push?: number}});
interface Phase {at: number; layers: Layer[]; tag?: string}

/** A turn of the glass takes this long; the content changes halfway. */
const SPIN = 1.0;

const Panel: KitVersion['component'] = ({props, context}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const end = durationInFrames / fps;
  const box = (props.box as Box | undefined) ?? {x: 440, y: 150, w: 1060, h: 596};
  const phases = props.phases as Phase[];
  const spins = (props.spin ?? true) ? phases.slice(1).map((p) => p.at) : [];
  const shownAt = (i: number) => phases[i]!.at + (i > 0 && spins.length ? SPIN / 2 : 0);
  const ci = phases.reduce((cur, _p, i) => (t >= shownAt(i) ? i : cur), 0);
  const since = t - shownAt(ci);
  const life = Math.max(0.5, (ci + 1 < phases.length ? shownAt(ci + 1) : end) - shownAt(ci));
  const spin = spins.reduce((s, a) => s + 360 * ease((t - a) / SPIN), 0);
  const on = props.appear ? clamp((t - (props.appear as {at: number}).at) / (props.appear as {dur: number}).dur) : 1;
  const fl = strikeAt(t, ((props.flash as {strikes: number[]} | undefined) ?? {strikes: []}).strikes);
  const inner: Box = {x: 0, y: 0, w: box.w - 20, h: box.h - 20};
  const pushed = (zoom: number | undefined, push: number | undefined, from = 0) => (zoom ?? 1.04) + (push ?? 0.06) * ease((since - from) / life);
  const deep = c.backdrop;
  const shades: Record<string, string> = {
    left: `linear-gradient(90deg, ${alpha(deep, 0.78)}, ${alpha(deep, 0.1)} 62%)`,
    'left-strong': `linear-gradient(90deg, ${alpha(deep, 0.88)}, ${alpha(deep, 0.35)} 62%, ${alpha(deep, 0.08)})`,
    quote: `linear-gradient(90deg, ${alpha(deep, 0.86)}, ${alpha(deep, 0.35)} 70%, ${alpha(deep, 0.15)})`,
    storm: `linear-gradient(90deg, ${alpha(deep, 0.85)}, ${alpha(deep, 0.25)} 70%)`,
  };
  const grid: React.CSSProperties = {position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${alpha(c.accent, 0.07)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(c.accent, 0.07)} 1px, transparent 1px)`, backgroundSize: '48px 48px'};
  const chip = (text: string, x: number, y: number, width: number) => (
    <div style={{position: 'absolute', left: x, top: y, transform: 'translateY(-100%)', padding: '8px 16px 9px', borderRadius: 10, background: alpha(c.plate, 1), border: `1px solid ${c.plateLine}`, boxShadow: `inset 0 2px 0 ${c.accent}`, fontFamily: fonts.sans, fontWeight: 600, fontSize: fitSize({family: look.fonts.sans, weight: 600}, [text], width - 44 - 34, 26, () => 2), letterSpacing: 2, color: c.text, whiteSpace: 'nowrap'}}>{text}</div>
  );
  const at = (x: number | undefined) => (x === undefined ? 1 : ramp(t, x - 0.2, x + 0.2));

  const body = (L: Layer): React.ReactNode => {
    if ('picture' in L) {
      const [cx, cy] = L.picture.focus ?? [0.5, 0.5];
      return <Cover src={L.picture.src} box={inner} cx={cx} cy={cy} zoom={pushed(L.picture.zoom, L.picture.push)} />;
    }
    if ('split' in L) {
      const n = L.split.items.length;
      const gap = L.split.gap ?? 16;
      const w = (inner.w - gap * (n - 1)) / n;
      return (
        <>
          {L.split.items.map((it, j) => {
            const [cx, cy] = it.focus ?? [0.5, 0.5];
            return (
              <div key={j} style={{position: 'absolute', left: j * (w + gap), top: 0, width: w, height: inner.h, overflow: 'hidden', opacity: at(it.at)}}>
                <Cover src={it.src} box={{x: 0, y: 0, w, h: inner.h}} cx={cx} cy={cy} zoom={pushed(undefined, undefined)} />
                {it.label ? chip(it.label, 22, inner.h - 22, w) : null}
              </div>
            );
          })}
          {L.split.sign ? (
            <div style={{position: 'absolute', left: inner.w / 2 - 50, top: inner.h / 2 - 50, width: 100, height: 100, borderRadius: 50, background: alpha(c.plate, 1), border: `2px solid ${c.plateLine}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.sans, fontWeight: 600, fontSize: 40, color: c.text}}>{L.split.sign}</div>
          ) : null}
        </>
      );
    }
    if ('clip' in L) {
      const [a, b] = L.clip.live ?? [-1, end + 1];
      const live = clamp((t - a) / 0.5) * clamp((b - t) / 0.5);
      return <div style={{position: 'absolute', inset: 0, transform: `scale(${pushed(1, L.clip.push ?? 0)})`}}><LoopClip src={L.clip.src} box={inner} live={live} frames={context.assetFrames[L.clip.src]} /></div>;
    }
    if ('grid' in L) {
      const [gx, gy] = L.grid.at ?? [0.5, 0.45];
      return <div style={{position: 'absolute', inset: 0, background: `radial-gradient(900px 500px at ${gx * 100}% ${gy * 100}%, ${alpha(c.accent, 0.22)}, ${deep})`}}><div style={grid} /></div>;
    }
    if ('dark' in L) return <div style={{position: 'absolute', inset: 0, background: alpha(deep, L.dark.amount)}} />;
    if ('portrait' in L) {
      const w = L.portrait.width ?? 420;
      return (
        <>
          <Cover src={L.portrait.src} box={{x: 0, y: 0, w, h: inner.h}} cy={L.portrait.focusY ?? 0.25} zoom={pushed(1, 0.05)} />
          <div style={{position: 'absolute', left: w, top: 0, right: 0, bottom: 0, background: alpha(deep, L.portrait.dark ?? 0.62)}}><div style={grid} /></div>
        </>
      );
    }
    const f = L.framed;
    const bx = f.box ?? {x: inner.w - 400, y: 30, w: 350, h: inner.h - 60};
    const [cx, cy] = f.focus ?? [0.5, 0.4];
    return (
      <div style={{position: 'absolute', left: bx.x, top: bx.y, width: bx.w, height: bx.h, opacity: f.at === undefined ? 1 : ramp(t, f.at - 0.3, f.at + 0.2), border: `2px solid ${alpha(c.text, 0.85)}`, borderRadius: 10, overflow: 'hidden', boxShadow: `0 20px 50px ${c.shadow}`}}>
        <Cover src={f.src} box={{x: 0, y: 0, w: bx.w, h: bx.h}} cx={cx} cy={cy} zoom={pushed(1.02, f.push, f.at === undefined ? 0 : f.at - shownAt(ci))} />
      </div>
    );
  };
  const layer = (L: Layer, key: number) => {
    const dim = L.dim ? 1 - L.dim.amount * ramp(t, L.dim.at, L.dim.at + 0.3) : 1;
    const shade = L.shade === undefined ? null : <div style={{position: 'absolute', inset: 0, background: typeof L.shade === 'number' ? alpha(deep, L.shade) : shades[L.shade]}} />;
    return <div key={key} style={{position: 'absolute', inset: 0, filter: dim < 1 ? `brightness(${dim})` : undefined}}>{body(L)}{shade}</div>;
  };
  const current = phases[ci]!;
  const turning = spins.some((a) => t >= a && t < a + SPIN);
  const camera = props.camera as Camera | undefined;
  return (
    <AbsoluteFill style={camera ? cameraStyle(t, camera) : undefined}>
      <Glass look={look} box={box} t={t} on={on} spin={spin} flash={fl}>
        <div style={{position: 'absolute', inset: 0}}>{current.layers.map(layer)}</div>
        {current.tag && !turning ? (
          <div style={{position: 'absolute', right: 14, bottom: 12, opacity: 0.72, fontFamily: fonts.sans, fontWeight: 600, fontSize: 18, letterSpacing: 3, color: '#fff', textShadow: look.measures.textShadow}}>{current.tag}</div>
        ) : null}
      </Glass>
    </AbsoluteFill>
  );
};

const Focus = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const Zoom = z.number().min(1).max(3);
const Push = z.number().min(0).max(1);
const Common = {
  shade: z.union([z.enum(['left', 'left-strong', 'quote', 'storm']), z.number().min(0).max(1)]).optional(),
  dim: z.object({at: z.number(), amount: z.number().min(0).max(1)}).strict().optional(),
};
const LayerSchema = z.union([
  z.object({picture: z.object({src: AssetUrl, focus: Focus.optional(), zoom: Zoom.optional(), push: Push.optional()}).strict(), ...Common}).strict(),
  z.object({split: z.object({items: z.array(z.object({src: AssetUrl, focus: Focus.optional(), at: z.number().optional(), label: z.string().min(1).max(30).optional()}).strict()).min(2).max(4), gap: z.number().min(0).max(80).optional(), sign: z.string().min(1).max(3).optional()}).strict(), ...Common}).strict(),
  z.object({clip: z.object({src: AssetUrl, live: z.tuple([z.number(), z.number()]).optional(), push: Push.optional()}).strict(), ...Common}).strict(),
  z.object({grid: z.object({at: Focus.optional()}).strict(), ...Common}).strict(),
  z.object({dark: z.object({amount: z.number().min(0).max(1)}).strict(), ...Common}).strict(),
  z.object({portrait: z.object({src: AssetUrl, width: z.number().positive().max(1000).optional(), focusY: z.number().min(0).max(1).optional(), dark: z.number().min(0).max(1).optional()}).strict(), ...Common}).strict(),
  z.object({framed: z.object({src: AssetUrl, box: BoxSchema.optional(), at: z.number().optional(), focus: Focus.optional(), push: Push.optional()}).strict(), ...Common}).strict(),
]);

const P = (extra: Record<string, unknown>) => ({look: DEMO_LOOK, ...extra});
const A = {$asset: 'a'};
const B = {$asset: 'b'};
const SAMPLES = {a: 'picture-a.png', b: 'picture-b.png'};

export const kit: KitVersion = {
  name: 'panel',
  version: '1.1.0',
  description: "The glass panel of a 16:9 lesson and what it shows phase by phase, as stacked layers — a picture, pictures side by side, a clip, a grid of light, a darkening, a portrait, a framed picture, shaded or dimmed — turning between phases, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    /** What the glass shows from each instant (seconds from the item's start), bottom layer first; the first phase from the start. */
    phases: z.array(z.object({at: z.number().min(0), layers: z.array(LayerSchema).min(1).max(6), tag: z.string().min(1).max(30).optional()}).strict()).min(1)
      .refine((ps) => ps.every((p, i) => i === 0 || p.at > ps[i - 1]!.at), {message: 'phases come one after the other, each at a later instant'}),
    /** The glass turns at each phase change unless false. */
    spin: z.boolean().optional(),
    /** It materialises over [at, at + dur] instead of being there. */
    appear: z.object({at: z.number().min(0), dur: z.number().positive()}).strict().optional(),
    flash: z.object({strikes: z.array(z.number())}).strict().optional(),
    camera: CameraSchema.optional(),
  }).strict(),
  component: Panel,
  examples: [
    {id: 'shaded', props: P({phases: [{at: 0, layers: [{picture: {src: A, focus: [0.5, 0.6]}, shade: 'left-strong'}], tag: 'AI RECONSTRUCTION'}]}), samples: SAMPLES, durationInFrames: 90, frame: 60},
    {id: 'split-three', props: P({phases: [{at: 0, layers: [{split: {items: [{src: A, label: 'THE FATHER'}, {src: B, at: 0.4, label: 'THE MOTHER'}, {src: A, at: 0.8, label: 'MARGHERITA'}]}}]}]}), samples: SAMPLES, durationInFrames: 60, frame: 45},
    {id: 'grid-portrait', props: P({phases: [{at: 0, layers: [{grid: {}}, {portrait: {src: B}}]}]}), samples: SAMPLES, durationInFrames: 60, frame: 30},
    {id: 'framed-dimmed', props: P({phases: [{at: 0, layers: [{picture: {src: A}, dim: {at: 0.2, amount: 0.5}}, {framed: {src: B, at: 0.3}}]}]}), samples: SAMPLES, durationInFrames: 60, frame: 45},
    {id: 'turning', props: P({phases: [{at: 0, layers: [{picture: {src: A}}]}, {at: 1, layers: [{clip: {src: {$asset: 'clip'}}, shade: 0.3}]}]}), samples: {...SAMPLES, clip: 'clip.mp4'}, durationInFrames: 90, frame: 40},
  ],
};
````

Create `packages/remotion-composer/src/kits/text-stack/1.0.0.tsx`:

````tsx
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
import {COLOR_ROLES, DEMO_LOOK, LookSchema, alpha, type ColorRole, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import type {Face} from '../lib/font-metrics/1.0.0.js';
import {fitLine} from '../lib/lesson-tools/1.0.0.js';
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

const Role = z.enum(COLOR_ROLES);
const TextItemSchema = z.object({
  kind: z.enum(['big', 'year', 'title', 'chip', 'quote', 'kicker', 'note']),
  text: z.string().min(1).max(200),
  at: z.number(),
  until: z.number().optional(),
  size: z.number().positive().max(240).optional(),
  color: Role.optional(),
  /** Wrap onto several lines (notes, quotes) instead of fitting one line to the width. */
  wrap: z.boolean().optional(),
}).strict();
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
````

Create `packages/remotion-composer/src/kits/timeline/1.0.0.tsx`:

````tsx
// timeline@1.0.0 — released: never edit this file; add timeline/<next>.tsx instead.
// A lesson's timeline, in one of two ways (from CreativeStudio's
// poesie-museo-long SciTimeline and its story scenes' timeline effect):
// - axis: a thread of light with a tick every five years, stops that light up
//   as they are named, labels above and below on as many lines as they need
//   not to overlap, a cursor running to the last lit stop;
// - stops: dots in a row with a label and a sub-label each, the line drawing
//   out towards them.
// Channel-neutral: the look is a prop (ADR-0040).
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {textWidth} from '../lib/font-metrics/1.0.0.js';
import {ease, ramp} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {SvgText} from '../lib/lesson-tools/1.0.0.js';
import type {Box} from '../lib/lesson-stage/1.0.0.js';

interface Axis {from: number; to: number; marks: {year: number; label?: string; at: number}[]}
interface Stops {items: {label: string; sub?: string; at: number}[]; lineFrom?: number; y?: number; x0?: number; step?: number}

const Timeline: KitVersion['component'] = ({props}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const box = props.box as Box;
  const axis = props.axis as Axis | undefined;
  const stops = props.stops as Stops | undefined;
  let body: React.ReactNode = null;
  if (axis) {
    const y = box.y + box.h / 2;
    const x0 = box.x + 40;
    const x1 = box.x + box.w - 40;
    const X = (yr: number) => x0 + ((x1 - x0) * (yr - axis.from)) / (axis.to - axis.from);
    const lit = axis.marks.filter((m) => t >= m.at);
    const last = lit.at(-1);
    const prev = lit.at(-2);
    const cur = last ? (prev ? X(prev.year) + (X(last.year) - X(prev.year)) * ease((t - last.at) / 0.8) : X(last.year)) : x0;
    // each label goes on the first line, above then below, where it does not touch the one before it there
    const LEVELS = [-20, 42, -52, 74];
    const ends = LEVELS.map(() => -1e9);
    const level = axis.marks.map((m) => {
      const half = textWidth({family: look.fonts.sans, weight: 600}, m.label ?? String(m.year), 26, 1) / 2;
      const xx = X(m.year);
      const free = LEVELS.findIndex((_, j) => xx - half > ends[j]! + 10);
      const j = free < 0 ? ends.indexOf(Math.min(...ends)) : free;
      ends[j] = xx + half;
      return LEVELS[j]!;
    });
    body = (
      <g>
        <defs><linearGradient id={`${id}f`} x1="0" x2="1"><stop offset="0" stopColor={c.accent} stopOpacity="0" /><stop offset=".08" stopColor={c.accent} stopOpacity=".9" /><stop offset=".92" stopColor={c.accent} stopOpacity=".9" /><stop offset="1" stopColor={c.accent} stopOpacity="0" /></linearGradient></defs>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={look.measures.plateRadius - 2} fill={alpha(c.plate, 0.86)} />
        <line x1={x0 - 30} y1={y} x2={x1 + 30} y2={y} stroke={`url(#${id}f)`} strokeWidth="1.5" opacity=".5" />
        <line x1={x0} y1={y} x2={cur} y2={y} stroke={c.accent} strokeWidth="3" />
        {Array.from({length: Math.floor((axis.to - axis.from) / 5) + 1}, (_, i) => <line key={i} x1={X(axis.from + i * 5)} y1={y - 5} x2={X(axis.from + i * 5)} y2={y + 5} stroke={alpha(c.text, 0.35)} strokeWidth="1" />)}
        {axis.marks.map((m, i) => {
          const on = ramp(t, m.at, m.at + 0.35);
          const xx = X(m.year);
          const isLast = !!last && last === m;
          const ring = (t * 1.1) % 1;
          return (
            <g key={i} opacity={0.45 + 0.55 * on}>
              <circle cx={xx} cy={y} r={on > 0.5 ? 7 : 4.5} fill={on > 0.5 ? c.highlight : alpha(c.text, 0.7)} />
              {isLast ? <circle cx={xx} cy={y} r={10 + 16 * ring} fill="none" stroke={c.highlight} strokeWidth="2" opacity={1 - ring} /> : null}
              <SvgText look={look} fonts={fonts} x={xx} y={y + level[i]!} size={26} anchor="middle" weight={600} ls={1} color={on > 0.5 ? c.highlight : c.text}>{m.label ?? String(m.year)}</SvgText>
            </g>
          );
        })}
      </g>
    );
  } else if (stops) {
    const y = box.y + (stops.y ?? 130);
    const x0 = box.x + (stops.x0 ?? 110);
    const step = stops.step ?? 205;
    const lineFrom = stops.lineFrom ?? stops.items[0]!.at;
    body = (
      <g>
        <line x1={box.x + 70} y1={y} x2={x0 + (step * (stops.items.length - 1) + 15) * ramp(t, lineFrom, lineFrom + 2)} y2={y} stroke={alpha(c.text, 0.6)} strokeWidth="1.2" />
        {stops.items.map((s, i) => (
          <g key={i} opacity={ramp(t, s.at, s.at + 0.4)}>
            <circle cx={x0 + i * step} cy={y} r={9} fill={c.glow} />
            <SvgText look={look} fonts={fonts} x={x0 + i * step} y={y - 34} size={34} anchor="middle" weight={600} ls={2}>{s.label}</SvgText>
            {s.sub ? <SvgText look={look} fonts={fonts} x={x0 + i * step} y={y + 50} size={30} anchor="middle" color={c.textDim}>{s.sub}</SvgText> : null}
          </g>
        ))}
      </g>
    );
  }
  return <AbsoluteFill><svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>{body}</svg></AbsoluteFill>;
};

export const kit: KitVersion = {
  name: 'timeline',
  version: '1.0.0',
  description: "A lesson's timeline in a 16:9 frame: an axis of years whose stops light up as they are named, or a row of dated stops the line draws out to, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** Where it is drawn (the axis's plate, or the box the stops are placed in). */
    box: BoxSchema,
    axis: z.object({
      from: z.number().int(),
      to: z.number().int(),
      marks: z.array(z.object({year: z.number(), label: z.string().min(1).max(12).optional(), at: z.number()}).strict()).min(1).max(12),
    }).strict().refine((a) => a.to > a.from && a.marks.every((m) => m.year >= a.from && m.year <= a.to), {message: 'an axis runs forward and holds its marks'}).optional(),
    stops: z.object({
      items: z.array(z.object({label: z.string().min(1).max(12), sub: z.string().min(1).max(20).optional(), at: z.number()}).strict()).min(1).max(5),
      lineFrom: z.number().optional(),
      y: z.number().optional(),
      x0: z.number().optional(),
      step: z.number().positive().optional(),
    }).strict().optional(),
  }).strict().refine((p) => (p.axis ? 1 : 0) + (p.stops ? 1 : 0) === 1, {message: 'a timeline is either an axis or stops'}),
  component: Timeline,
  examples: [
    {id: 'axis', props: {look: DEMO_LOOK, box: {x: 430, y: 620, w: 1100, h: 170}, axis: {from: 1860, to: 1900, marks: [{year: 1861, at: 0}, {year: 1867, at: 0.6}, {year: 1891, at: 1.2}, {year: 1894, at: 1.8}]}}, durationInFrames: 90, frame: 75},
    {id: 'axis-close', props: {look: DEMO_LOOK, box: {x: 430, y: 620, w: 1100, h: 170}, axis: {from: 1860, to: 1900, marks: [{year: 1867, at: 0}, {year: 1868, at: 0.3}, {year: 1869, at: 0.6}, {year: 1871, at: 0.9}]}}, durationInFrames: 60, frame: 50},
    {id: 'stops', props: {look: DEMO_LOOK, box: {x: 440, y: 150, w: 1060, h: 596}, stops: {items: [{label: '1867', sub: 'the father', at: 0}, {label: '1868', sub: 'the mother', at: 0.5}, {label: '1871', sub: 'Margherita', at: 1}, {label: '1876', sub: 'Luigi', at: 1.5}]}}, durationInFrames: 90, frame: 70},
  ],
};
````

Create `packages/remotion-composer/src/kits/story-fx/1.0.0.tsx`:

````tsx
// story-fx@1.0.0 — released: never edit this file; add story-fx/<next>.tsx instead.
// The effects a lesson's story scenes draw over the panel (from CreativeStudio's
// poesie-museo-long story engine): a row of people lighting up (how many in
// ten), an arrow that curves out to its point, a round badge, a live bolt that
// strikes, a line of light. Positions are inside the panel box. Channel-neutral:
// the look is a prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {COLOR_ROLES, DEMO_LOOK, LookSchema, alpha, type ColorRole, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {clamp, ramp} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {LiveBolt, boltPoints, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {LightLine, SvgText, ptsPath} from '../lib/lesson-tools/1.0.0.js';

type Effect =
  | {people: {at: number; total?: number; lit?: number; extra?: {at: number}; x0?: number; y?: number; step?: number}}
  | {arc: {at: number; path: [number, number, number, number, number, number]; color?: ColorRole}}
  | {badge: {text: string; x: number; y: number}}
  | {bolt: {strikes: number[]; path?: [number, number, number, number]; seed?: number}}
  | {lightline: {at: number; until: number; path?: [number, number, number, number]}};

const StoryFx: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? {x: 440, y: 150, w: 1060, h: 596};
  const draw = (e: Effect, key: number): React.ReactNode => {
    if ('people' in e) {
      const f = e.people;
      const total = f.total ?? 10;
      const lit = f.lit ?? 5;
      return (
        <g key={key}>
          {Array.from({length: total}, (_, j) => {
            const on = ramp(t, f.at - 0.2 + j * 0.07, f.at + 0.05 + j * 0.07);
            const isLit = j < lit || (f.extra !== undefined && j === lit && t > f.extra.at);
            const cx = P.x + (f.x0 ?? 134) + j * (f.step ?? 88);
            const cy = P.y + (f.y ?? 300);
            const fill = isLit ? c.highlight : alpha(c.text, 0.75);
            return <g key={j} opacity={on}><circle cx={cx} cy={cy - 48} r={22} fill={fill} /><rect x={cx - 28} y={cy - 20} width={56} height={90} rx={24} fill={fill} /></g>;
          })}
        </g>
      );
    }
    if ('arc' in e) {
      const k = clamp((t - e.arc.at) / 1.2);
      const [x0, y0, cx, cy, x1, y1] = e.arc.path;
      const color = c[e.arc.color ?? 'highlight'];
      if (k <= 0) return null;
      const angle = Math.atan2(y1 - cy, x1 - cx);
      const head = [[x1, y1], [x1 - 22 * Math.cos(angle - 0.45), y1 - 22 * Math.sin(angle - 0.45)], [x1 - 22 * Math.cos(angle + 0.45), y1 - 22 * Math.sin(angle + 0.45)]].map(([x, y]) => `${P.x + x!},${P.y + y!}`).join(' ');
      return (
        <g key={key} opacity={k}>
          <path d={`M${P.x + x0} ${P.y + y0} Q${P.x + cx} ${P.y + cy} ${P.x + x1} ${P.y + y1}`} stroke={color} strokeWidth="6" fill="none" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - k} />
          {k > 0.95 ? <polygon points={head} fill={color} /> : null}
        </g>
      );
    }
    if ('badge' in e) {
      const cx = P.x + e.badge.x;
      const cy = P.y + e.badge.y;
      return (
        <g key={key}>
          <circle cx={cx} cy={cy} r={62} fill={alpha(c.plate, 0.8)} stroke={alpha(c.text, 0.7)} />
          <SvgText look={look} fonts={fonts} x={cx} y={cy + 22} size={60} anchor="middle" weight={200}>{e.badge.text}</SvgText>
        </g>
      );
    }
    if ('bolt' in e) {
      const [x0, y0, x1, y1] = e.bolt.path ?? [820, 10, 760, 420];
      return <LiveBolt key={key} look={look} t={t} x0={P.x + x0} y0={P.y + y0} x1={P.x + x1} y1={P.y + y1} op={e.bolt.strikes.reduce((m, a) => m + strikeAt(t, [a]), 0)} seed={e.bolt.seed ?? 9} grow={1} />;
    }
    const [x0, y0, x1, y1] = e.lightline.path ?? [880, 20, 840, P.h - 30];
    const op = strikeAt(t, [e.lightline.at]) + 0.25 * ramp(t, e.lightline.at + 0.05, e.lightline.at + 0.45) * (1 - ramp(t, e.lightline.until, e.lightline.until + 0.5));
    return <LightLine key={key} look={look} d={ptsPath(boltPoints(P.x + x0, P.y + y0, P.x + x1, P.y + y1, 11, 5, 120))} op={op} width={4} />;
  };
  return <AbsoluteFill><svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>{(props.effects as Effect[]).map(draw)}</svg></AbsoluteFill>;
};

const Path4 = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const EffectSchema = z.union([
  z.object({people: z.object({at: z.number(), total: z.number().int().min(1).max(14).optional(), lit: z.number().int().min(0).optional(), extra: z.object({at: z.number()}).strict().optional(), x0: z.number().optional(), y: z.number().optional(), step: z.number().positive().optional()}).strict()}).strict(),
  z.object({arc: z.object({at: z.number(), path: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]), color: z.enum(COLOR_ROLES).optional()}).strict()}).strict(),
  z.object({badge: z.object({text: z.string().min(1).max(4), x: z.number(), y: z.number()}).strict()}).strict(),
  z.object({bolt: z.object({strikes: z.array(z.number()).min(1), path: Path4.optional(), seed: z.number().int().optional()}).strict()}).strict(),
  z.object({lightline: z.object({at: z.number(), until: z.number(), path: Path4.optional()}).strict()}).strict(),
]);

export const kit: KitVersion = {
  name: 'story-fx',
  version: '1.0.0',
  description: "The effects of a lesson's story scenes over the 16:9 panel — people lighting up, a curving arrow, a badge, a striking bolt, a line of light — in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** The panel the effects are placed in (default 440/150/1060×596). */
    box: BoxSchema.optional(),
    effects: z.array(EffectSchema).min(1).max(8),
  }).strict(),
  component: StoryFx,
  examples: [
    {id: 'people', props: {look: DEMO_LOOK, effects: [{people: {at: 0, lit: 5, extra: {at: 1.5}}}]}, durationInFrames: 90, frame: 60},
    {id: 'arc-and-badge', props: {look: DEMO_LOOK, effects: [{arc: {at: 0, path: [120, 420, 500, 80, 900, 380]}}, {badge: {text: '11', x: 530, y: 290}}]}, durationInFrames: 60, frame: 45},
    {id: 'bolt-and-line', props: {look: DEMO_LOOK, effects: [{bolt: {strikes: [0.5]}}, {lightline: {at: 0.2, until: 3}}]}, durationInFrames: 60, frame: 18},
  ],
};
````

Create `packages/remotion-composer/src/kits/word-tracks/1.0.0.tsx`:

````tsx
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
````

Create `packages/remotion-composer/src/kits/interlinear/1.0.0.tsx`:

````tsx
// interlinear@1.0.0 — released: never edit this file; add interlinear/<next>.tsx instead.
// A translation word under word (from CreativeStudio's poesie-museo-long note
// on the text): each foreign word lights when it is said, its translation
// under a thin rule when it is given; struck words turn to the signal colour,
// are crossed out and close up. Columns never compress: when the words do not
// fit the width, all of them shrink together. Channel-neutral: the look is a
// prop (ADR-0040).
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {textWidth} from '../lib/font-metrics/1.0.0.js';
import {ease, ramp} from '../lib/stage-math/1.0.0.js';

interface Word {text: string; gloss: string; at: number; glossAt: number}
const GAP = 26;

const Interlinear: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const words = props.words as Word[];
  const strike = props.strike as {indices: number[]; at: number} | undefined;
  const width = props.width as number;
  const serif = {family: look.fonts.serif, weight: 400, style: 'italic' as const};
  const sans = {family: look.fonts.sans, weight: 600};
  // each column as wide as the wider of its word and its translation
  const natural = words.reduce((s, w, i) => s + Math.max(textWidth(serif, w.text, 44), textWidth(sans, w.gloss, 30)) + (i ? GAP : 0), 0);
  const k = Math.min(1, width / natural);
  const drop = strike ? ease((t - strike.at - 0.2) / 0.8) : 0;
  return (
    <div style={{position: 'absolute', left: (props.x as number) - width / 2, top: props.y as number, width, display: 'flex', justifyContent: 'center', alignItems: 'flex-start'}}>
      {words.map((w, i) => {
        const on = ramp(t, w.at - 0.05, w.at + 0.2);
        const gOn = ramp(t, w.glossAt - 0.05, w.glossAt + 0.25);
        const struck = !!strike && strike.indices.includes(i);
        const cut = struck ? drop : 0;
        const red = struck && t > strike!.at;
        const col = Math.max(textWidth(serif, w.text, 44 * k), textWidth(sans, w.gloss, 30 * k));
        return (
          <div key={i} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 * k, marginLeft: i ? GAP * k * (1 - cut) : 0, opacity: 1 - cut, flexShrink: 0,
            width: col * (1 - cut), overflow: cut > 0 ? 'hidden' : 'visible'}}>
            <div style={{fontFamily: fonts.serif, fontStyle: 'italic', fontSize: 44 * k, color: red ? c.signal : c.text, opacity: on, textShadow: look.measures.textShadow, whiteSpace: 'nowrap', textDecoration: red ? 'line-through' : 'none'}}>{w.text}</div>
            <div style={{width: '100%', height: 1.5, background: alpha(c.text, 0.45), opacity: gOn}} />
            <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: 30 * k, color: red ? c.signal : c.glow, opacity: gOn, textShadow: look.measures.textShadow, whiteSpace: 'nowrap'}}>{w.gloss}</div>
          </div>
        );
      })}
    </div>
  );
};

const LATIN = [['Non', 'not'], ['omnis', 'everyone'], ['arbusta', 'shrubs'], ['iuvant', 'please'], ['humilesque', 'and the humble'], ['myricae', 'tamarisks']] as const;
const words = (from: number) => LATIN.map(([text, gloss], i) => ({text, gloss, at: from + i * 0.4, glossAt: from + 3 + i * 0.4}));

export const kit: KitVersion = {
  name: 'interlinear',
  version: '1.0.0',
  description: "A translation word under word in a 16:9 frame: each word lit when it is said, its translation under it, struck words crossed out in the signal colour and closed up, in the channel theme's look.",
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** The block's centre and top. */
    x: z.number(),
    y: z.number(),
    width: z.number().positive().max(1728),
    words: z.array(z.object({text: z.string().min(1).max(30), gloss: z.string().min(1).max(30), at: z.number(), glossAt: z.number()}).strict()).min(1).max(10),
    strike: z.object({indices: z.array(z.number().int().min(0)).min(1), at: z.number()}).strict().optional(),
  }).strict().refine((p) => !p.strike || p.strike.indices.every((i) => i < p.words.length), {message: 'a struck word is one of the words', path: ['strike', 'indices']}),
  component: Interlinear,
  examples: [
    {id: 'glossed', props: {look: DEMO_LOOK, x: 970, y: 340, width: 1000, words: words(0)}, durationInFrames: 180, frame: 150},
    {id: 'said', props: {look: DEMO_LOOK, x: 970, y: 340, width: 1000, words: words(0)}, durationInFrames: 180, frame: 50},
    {id: 'struck', props: {look: DEMO_LOOK, x: 970, y: 340, width: 1000, words: words(0), strike: {indices: [0, 1], at: 5.5}}, durationInFrames: 240, frame: 200},
  ],
};
````

Create `packages/remotion-composer/src/kits/monitor-wall/1.0.0.tsx`:

````tsx
// monitor-wall@1.0.0 — released: never edit this file; add monitor-wall/<next>.tsx instead.
// The invitation to listen again (from CreativeStudio's poesie-museo-long card):
// a wall of glass monitors — the lesson's pictures and a clip — appearing one
// after the other in a grid that adapts to how many there are, and a caption on
// a full plate under them, never over them. Channel-neutral: the look is a
// prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {COLOR_ROLES, DEMO_LOOK, LookSchema, plateStyle, type ColorRole, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ramp} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LoopClip, type Box} from '../lib/lesson-stage/1.0.0.js';

interface Cell {src: string; focus?: [number, number]; kind?: 'picture' | 'clip'}

const MonitorWall: KitVersion['component'] = ({props, context}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const t = useCurrentFrame() / useVideoConfig().fps;
  const G = (props.box as Box | undefined) ?? {x: 480, y: 140, w: 980, h: 560};
  const cells = props.cells as Cell[];
  const appear = (props.appear as number | undefined) ?? 0;
  const caption = (props.caption as {text: string; at: number; color?: ColorRole}[] | undefined) ?? [];
  // 2 columns up to 4 cells, 3 up to 6, 4 beyond
  const NC = cells.length <= 4 ? 2 : cells.length <= 6 ? 3 : 4;
  const NR = Math.ceil(cells.length / NC);
  const gw = (G.w - 20 * (NC - 1)) / NC;
  const gh = (G.h - 24 * (NR - 1)) / NR;
  const capSize = caption.length ? fitSize({family: look.fonts.display, weight: 400}, [caption.map((x) => x.text).join('   ')], 1680 - 88, 76, () => 2) : 76;
  return (
    <AbsoluteFill>
      {cells.map((cell, i) => {
        const bx: Box = {x: G.x + (i % NC) * (gw + 20), y: G.y + Math.floor(i / NC) * (gh + 24), w: gw, h: gh};
        const inner: Box = {x: 0, y: 0, w: gw - 20, h: gh - 20};
        const [cx, cy] = cell.focus ?? [0.5, 0.5];
        return (
          <Glass key={i} look={look} box={bx} t={t} on={ramp(t, appear - 0.3 + i * 0.12, appear + 0.2 + i * 0.12)} tilt={0}>
            {cell.kind === 'clip' ? <LoopClip src={cell.src} box={inner} live={1} frames={context.assetFrames[cell.src]} /> : <Cover src={cell.src} box={inner} cx={cx} cy={cy} />}
          </Glass>
        );
      })}
      {caption.length ? (
        <div style={{position: 'absolute', left: 0, right: 0, top: G.y + G.h + 40, display: 'flex', justifyContent: 'center'}}>
          <div style={{display: 'flex', gap: 34, alignItems: 'baseline', padding: '18px 44px 22px', ...plateStyle(look), opacity: ramp(t, caption[0]!.at - 0.3, caption[0]!.at + 0.1)}}>
            {caption.map((x, i) => <div key={i} style={{fontFamily: fonts.display, fontSize: capSize, letterSpacing: 2, color: look.colors[x.color ?? 'text'], opacity: ramp(t, x.at, x.at + 0.3), whiteSpace: 'nowrap'}}>{x.text}</div>)}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const SIX = Array.from({length: 6}, (_, i) => ({src: {$asset: i % 2 ? 'b' : 'a'}}));

export const kit: KitVersion = {
  name: 'monitor-wall',
  version: '1.0.0',
  description: "A wall of glass monitors in a 16:9 frame — a lesson's pictures and a clip, appearing one after another in a grid that adapts — with a caption on a plate under them, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** The grid's box (default 480/140/980×560); the caption sits 40 px under it. */
    box: BoxSchema.optional(),
    cells: z.array(z.object({src: AssetUrl, focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(), kind: z.enum(['picture', 'clip']).optional()}).strict()).min(1).max(8),
    /** The monitors appear one after the other from here. */
    appear: z.number().optional(),
    caption: z.array(z.object({text: z.string().min(1).max(30), at: z.number(), color: z.enum(COLOR_ROLES).optional()}).strict()).max(3).optional(),
  }).strict(),
  component: MonitorWall,
  examples: [
    {id: 'six', props: {look: DEMO_LOOK, cells: SIX, caption: [{text: 'SAME WORDS.', at: 1}, {text: 'ANOTHER LOOK.', at: 1.6, color: 'highlight'}]}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 90, frame: 75},
    {id: 'four-with-clip', props: {look: DEMO_LOOK, cells: [...SIX.slice(0, 3), {src: {$asset: 'clip'}, kind: 'clip'}]}, samples: {a: 'picture-a.png', b: 'picture-b.png', clip: 'clip.mp4'}, durationInFrames: 60, frame: 45},
    {id: 'appearing', props: {look: DEMO_LOOK, cells: SIX, appear: 0.3}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 60, frame: 18},
  ],
};
````

Create `packages/remotion-composer/src/kits/summary/1.0.0.tsx`:

````tsx
// summary@1.0.0 — released: never edit this file; add summary/<next>.tsx instead.
// A lesson's summary (from CreativeStudio's poesie-museo-long): one row per
// picture on a full plate, its thumbnail on glass, its keyword and its figure,
// arriving as each keyword is said; then a closing line on a highlight edge and
// a flash that lights every thumbnail. Channel-neutral: the look is a prop
// (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ramp} from '../lib/stage-math/1.0.0.js';
import {AssetUrl} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {back} from '../lib/lesson-tools/1.0.0.js';

interface Row {src: string; focus?: [number, number]; keyword: string; figure: string; at: number}

const Summary: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const rows = props.rows as Row[];
  const closing = props.closing as {text: string; at: number} | undefined;
  const lit = props.lit as number | undefined;
  const X0 = (props.x as number | undefined) ?? 700;
  const Y0 = (props.y as number | undefined) ?? 130;
  const DY = Math.min(142, 710 / Math.max(5, rows.length));
  const room = 820 - 250 - 30;
  const kwSize = fitSize({family: look.fonts.display, weight: 400}, rows.map((r) => r.keyword), room, 52, () => 3);
  const figSize = fitSize({family: look.fonts.sans, weight: 600}, rows.map((r) => r.figure), room, 28, () => 3);
  const closeSize = closing ? fitSize({family: look.fonts.display, weight: 400}, [closing.text], 820 - 60, 84, () => 3) : 84;
  return (
    <AbsoluteFill>
      {rows.map((r, i) => {
        const slide = (1 - back((t - r.at) / 0.4)) * 40;
        const flash = lit === undefined ? 0 : strikeAt(t, [lit + i * 0.08]);
        const bx: Box = {x: X0 + 14, y: Y0 + 8 + i * DY, w: 200, h: 112};
        const [cx, cy] = r.focus ?? [0.5, 0.5];
        return (
          <div key={i} style={{position: 'absolute', inset: 0, opacity: ramp(t, r.at - 0.1, r.at + 0.3)}}>
            <div style={{position: 'absolute', left: X0, top: Y0 + i * DY, width: 820, height: 128, ...plateStyle(look), transform: `translateX(${slide}px)`}} />
            <Glass look={look} box={bx} t={t} on={ramp(t, r.at - 0.1, r.at + 0.3)} tilt={0} flash={flash}>
              <Cover src={r.src} box={{x: 0, y: 0, w: 180, h: 92}} cx={cx} cy={cy} filter={`brightness(${1 + 0.6 * flash})`} />
            </Glass>
            <div style={{position: 'absolute', left: X0 + 250, top: Y0 + i * DY + 18, transform: `translateX(${slide}px)`}}>
              <div style={{fontFamily: fonts.display, fontSize: kwSize, letterSpacing: 3, color: c.text, lineHeight: 1, whiteSpace: 'nowrap'}}>{r.keyword}</div>
              <div style={{fontFamily: fonts.sans, fontWeight: 600, fontSize: figSize, letterSpacing: 3, color: c.glow, marginTop: 10, whiteSpace: 'nowrap'}}>{r.figure}</div>
            </div>
          </div>
        );
      })}
      {closing ? (
        <div style={{position: 'absolute', left: X0, top: Y0 + rows.length * DY + 10, opacity: ramp(t, closing.at - 0.1, closing.at + 0.3), padding: '12px 30px 16px', ...plateStyle(look, false), border: `1px solid ${c.highlight}`}}>
          <div style={{fontFamily: fonts.display, fontSize: closeSize, letterSpacing: 3, color: c.highlight, lineHeight: 1, whiteSpace: 'nowrap'}}>{closing.text}</div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const ROWS = [['REVELATION', 'REVELATION'], ['BODY', 'PERSONIFICATION'], ['FRACTURE', 'CLIMAX'], ['CONTRAST', 'OXYMORON'], ['LOOK', 'SIMILE']].map(([keyword, figure], i) => ({src: {$asset: i % 2 ? 'b' : 'a'}, keyword, figure, at: i * 0.5}));

export const kit: KitVersion = {
  name: 'summary',
  version: '1.0.0',
  description: "A lesson's summary in a 16:9 frame: one row per picture — thumbnail, keyword, figure — arriving as each keyword is said, a closing line and a flash that lights them all, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    /** The rows' left edge and top (default 700, 130: the empty side of the hall). */
    x: z.number().optional(),
    y: z.number().optional(),
    rows: z.array(z.object({src: AssetUrl, focus: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(), keyword: z.string().min(1).max(20), figure: z.string().min(1).max(40), at: z.number()}).strict()).min(1).max(8),
    closing: z.object({text: z.string().min(1).max(24), at: z.number()}).strict().optional(),
    /** Every thumbnail lights up from here, one after the other. */
    lit: z.number().optional(),
  }).strict(),
  component: Summary,
  examples: [
    {id: 'five', props: {look: DEMO_LOOK, rows: ROWS, closing: {text: 'STAY LIT.', at: 3}}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 120, frame: 105},
    {id: 'arriving', props: {look: DEMO_LOOK, rows: ROWS}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 60, frame: 32},
    {id: 'lit', props: {look: DEMO_LOOK, rows: ROWS, closing: {text: 'STAY LIT.', at: 3}, lit: 3.2}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 120, frame: 98},
  ],
};
````

Create `packages/remotion-composer/src/kits/progress/1.0.0.tsx`:

````tsx
// progress@1.0.0 — released: never edit this file; add progress/<next>.tsx instead.
// Where a lesson is among its pictures (from CreativeStudio's poesie-museo-long
// specimens): a plate above the panel with one segment per picture — finished
// ones show their keyword, the current one is in the accent colour, the rest
// show their number. Channel-neutral: the look is a prop (ADR-0040).
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {z} from 'zod';
import type {KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {SvgText} from '../lib/lesson-tools/1.0.0.js';
import type {Box} from '../lib/lesson-stage/1.0.0.js';

const Progress: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const P = (props.box as Box | undefined) ?? {x: 440, y: 150, w: 1060, h: 596};
  const steps = props.steps as {label: string}[];
  const current = props.current as number;
  const done = props.done as number;
  const seg = P.w / steps.length;
  const size = fitSize({family: look.fonts.sans, weight: 600}, steps.map((s) => s.label), seg - 24, 24);
  return (
    <AbsoluteFill>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <rect x={P.x - 6} y={P.y - 70} width={P.w + 12} height={60} rx={12} fill={alpha(c.plate, 0.9)} stroke={alpha(c.text, 0.35)} />
        {steps.map((s, i) => {
          const isDone = i < done;
          const cur = i === current;
          const x0 = P.x + i * seg + 10;
          return (
            <g key={i}>
              <rect x={x0} y={P.y - 22} width={seg - 20} height={cur ? 5 : 3} fill={cur ? c.accent : isDone ? alpha(c.text, 0.85) : alpha(c.text, 0.4)} />
              <SvgText look={look} fonts={fonts} x={x0} y={P.y - 34} size={size} weight={600} color={cur ? c.accent : isDone ? c.text : alpha(c.text, 0.7)}>{isDone || cur ? s.label : `${i + 1}`}</SvgText>
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

const STEPS = ['REVELATION', 'BODY', 'FRACTURE', 'CONTRAST', 'LOOK'].map((label) => ({label}));

export const kit: KitVersion = {
  name: 'progress',
  version: '1.0.0',
  description: "Where a lesson is among its pictures, on a plate above the 16:9 panel: finished segments named, the current one in the accent colour, the rest numbered, in the channel theme's look.",
  layer: 'overlay',
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    steps: z.array(z.object({label: z.string().min(1).max(20)}).strict()).min(1).max(8),
    current: z.number().int().min(0),
    /** How many are finished (the first `done`). */
    done: z.number().int().min(0),
  }).strict().refine((p) => p.current < p.steps.length && p.done <= p.steps.length, {message: 'current and done count among the steps', path: ['current']}),
  component: Progress,
  examples: [
    {id: 'third', props: {look: DEMO_LOOK, steps: STEPS, current: 2, done: 2}, durationInFrames: 30, frame: 0},
    {id: 'first', props: {look: DEMO_LOOK, steps: STEPS, current: 0, done: 0}, durationInFrames: 30, frame: 0},
  ],
};
````

In `src/kits/index.ts`, import them after `interprete110`:

```ts
import {kit as panel110} from './panel/1.1.0.js';
import {kit as textStack100} from './text-stack/1.0.0.js';
import {kit as timeline100} from './timeline/1.0.0.js';
import {kit as storyFx100} from './story-fx/1.0.0.js';
import {kit as wordTracks100} from './word-tracks/1.0.0.js';
import {kit as interlinear100} from './interlinear/1.0.0.js';
import {kit as monitorWall100} from './monitor-wall/1.0.0.js';
import {kit as summary100} from './summary/1.0.0.js';
import {kit as progress100} from './progress/1.0.0.js';
```

and add a line to `KIT_VERSIONS` after the one ending in `interprete110,`:

```ts
  panel110, textStack100, timeline100, storyFx100, wordTracks100, interlinear100, monitorWall100, summary100, progress100,
```

- [ ] **Step 3: Lock, previews, tests**

Run: `npm run kits:lock`. The new entries must be exactly:

```json
  "interlinear@1.0.0": "sha256:1e09e7249e11bdc543985d1d7f4f5ba36d9f3ab655e29fc8c641c6f67072658b",
  "monitor-wall@1.0.0": "sha256:660882e837a2926751c9fc2ced1471b3d6cf0aa1dbcf8c0198bd7d4636f528e2",
  "panel@1.1.0": "sha256:a56be039e917d11d1e4b97a26e89db7f4fe563061bb915fcacac33c5ac611d3d",
  "progress@1.0.0": "sha256:db5e46695f0bc1d48e72d53743508de82284fcecc7e131208fd67c48f131ed3c",
  "story-fx@1.0.0": "sha256:e7f1cf62c265ff8569c84766d7349a9bb69ad2dd639bbae9d771a000fbce85c7",
  "summary@1.0.0": "sha256:5887f8bb99d2620e84062452ee5e2af3318938ae21ce72ea5a4f243ed0d2bc7a",
  "text-stack@1.0.0": "sha256:05c42ba713d267f9087efa621dbeb554cf992478eba30c2ebc4aecbb22afaaaf",
  "timeline@1.0.0": "sha256:e817c09bbd4324aa848821efa462ea48bf6287b1cc73fabbd04e5cf8c4b3fba7",
  "word-tracks@1.0.0": "sha256:6b45047597b9084fba086d84b2051fabe6d57ab36a7fd34725f66f35193a95ba",
```

Take the previews rendered in the prototype rather than running `npm run kits:previews`:

```bash
git -C "$(git rev-parse --show-toplevel)" checkout d555e4d -- \
  packages/remotion-composer/previews/panel@1.1.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/text-stack@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/timeline@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/story-fx@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/word-tracks@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/interlinear@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/monitor-wall@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/summary@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/progress@1.0.0.youtube-1920x1080.png
```

Run: `npx tsc --noEmit && npm test`
Expected: PASS. That includes:
- one real frame of every example in 16:9 only;
- every overlay inside the safe zone, shadows included;
- every version's committed preview;
- the lock check.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/panel/1.1.0.tsx \
  packages/remotion-composer/src/kits/text-stack/1.0.0.tsx \
  packages/remotion-composer/src/kits/timeline/1.0.0.tsx \
  packages/remotion-composer/src/kits/story-fx/1.0.0.tsx \
  packages/remotion-composer/src/kits/word-tracks/1.0.0.tsx \
  packages/remotion-composer/src/kits/interlinear/1.0.0.tsx \
  packages/remotion-composer/src/kits/monitor-wall/1.0.0.tsx \
  packages/remotion-composer/src/kits/summary/1.0.0.tsx \
  packages/remotion-composer/src/kits/progress/1.0.0.tsx \
  packages/remotion-composer/previews/panel@1.1.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/text-stack@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/timeline@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/story-fx@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/word-tracks@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/interlinear@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/monitor-wall@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/summary@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/progress@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/src/kits/index.ts packages/remotion-composer/test/validate.test.ts packages/remotion-composer/kits.lock.json
git commit -m "The lesson's narrative tools: layered panel, text stacks, timelines, story effects, word tracks, interlinear, monitor wall, summary, progress (avg-dcf.4.2.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The figure tools (avg-dcf.4.2.2)

**Files:**
- Create: the five kits below, and their five `previews/*.youtube-1920x1080.png`.
- Modify: `packages/remotion-composer/src/kits/index.ts`, `test/validate.test.ts`, `kits.lock.json`.

**Interfaces:**
- Consumes: Task 1's library (`PictureSchema`, `PANEL`, `coverPoint`, `fitLine`, `GlassChip`, `LightTitle`, `IrisLive`, `Eyelids`, `Shards`, `Smoke`, `Wind`, `LightLine`, `wavePath`, `Tag`, `SvgText`, `back`); `lib/lesson-stage` (`Glass`, `Cover`, `LoopClip`, `LiveBolt`, `boltPoints`, `strikeAt`).
- Produces: the kits `merge@1.0.0`, `cards@1.0.0`, `stack@1.0.0`, `oxymoron@1.0.0`, `simile@1.0.0`.

- [ ] **Step 1: Write the failing tests**

In `packages/remotion-composer/test/validate.test.ts`:

1. In "refuses malformed teaching tools at their paths", add after the `summary` assertion:

```ts
    const times = {a: 2, b: 1, tear: 3, verb: 4, result: 5, end: 6};
    const labels = {a: 'A', b: 'B', verb: 'V', result: 'R'};
    assert.deepEqual(refused('merge', {picture: pic, times, labels}), at('times'));
    const card = {word: 'W', gloss: 'g', icon: 'bruise', at: 0};
    assert.deepEqual(refused('cards', {picture: pic, cards: [card, card, card, card], times: {human: 1, end: 2}}), at('cards'));
    const step = {word: 'W', gloss: 'g'};
    assert.deepEqual(refused('stack', {picture: pic, steps: [step, step], labels: {weight: 'W'}, times: {w1: 0, w2: 1, w3: 2, stairs: 3, s1: 4, s2: 5, s3: 6, collapse: 7}}), at('steps'));
```

2. Make the listing:

```ts
    assert.deepEqual(listKits(ids).map((k) => [k.name, k.version, k.layer]), [
      ['block-title', '1.0.0', 'overlay'],
      ['brand-mark', '1.0.0', 'overlay'],
      ['brand-mark', '2.0.0', 'overlay'],
      ['captions', '1.0.0', 'fill'],
      ['captions', '1.1.0', 'overlay'],
      ['cards', '1.0.0', 'fill'],
      ['chapter-opener', '1.0.0', 'fill'],
      ['clip', '1.0.0', 'fill'],
      ['cover', '1.0.0', 'fill'],
      ['figure-title', '1.0.0', 'overlay'],
      ['interlinear', '1.0.0', 'overlay'],
      ['interprete', '1.0.0', 'fill'],
      ['interprete', '1.1.0', 'fill'],
      ['lower-third', '1.0.0', 'overlay'],
      ['merge', '1.0.0', 'fill'],
      ['monitor-wall', '1.0.0', 'fill'],
      ['museum-hall', '1.0.0', 'fill'],
      ['oxymoron', '1.0.0', 'fill'],
      ['panel', '1.0.0', 'fill'],
      ['panel', '1.1.0', 'fill'],
      ['progress', '1.0.0', 'overlay'],
      ['room', '1.0.0', 'fill'],
      ['room-effect', '1.0.0', 'fill'],
      ['simile', '1.0.0', 'fill'],
      ['stack', '1.0.0', 'fill'],
      ['still', '1.0.0', 'fill'],
      ['story-fx', '1.0.0', 'fill'],
      ['summary', '1.0.0', 'fill'],
      ['text-stack', '1.0.0', 'overlay'],
      ['timeline', '1.0.0', 'fill'],
      ['title-chip', '1.0.0', 'overlay'],
      ['verse-bar', '1.0.0', 'overlay'],
      ['verse-plate', '1.0.0', 'overlay'],
      ['warp', '1.0.0', 'fill'],
      ['word-tracks', '1.0.0', 'fill'],
    ]);
```

Run: `cd packages/remotion-composer && node --import tsx --test test/validate.test.ts`
Expected: FAIL (the figure tools do not exist).

- [ ] **Step 2: The kits**

Create `packages/remotion-composer/src/kits/merge/1.0.0.tsx`:

````tsx
// merge@1.0.0 — released: never edit this file; add merge/<next>.tsx instead.
// The figure tool for a fusion of two things into one (from CreativeStudio's
// poesie-museo-long specimen «merge»): the panel is dark and a live bolt
// crawls in it; the two words arrive as chips; the dark tears in two along a
// jagged line of light and its halves part on the picture, where bolts keep
// striking; the verb that joins the words shows, then the two chips meet in
// the result. It draws its own glass panel. Channel-neutral: the look is a
// prop (ADR-0040).
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {clamp, ease, ramp, rnd, win} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LiveBolt, boltPoints, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {GlassChip, LightLine, PANEL, PictureSchema, ptsPath, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Times {a: number; b: number; tear: number; verb: number; result: number; end: number}
interface Labels {a: string; b: string; verb: string; verbSub?: string; result: string}

const Merge: KitVersion['component'] = ({props}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const k = clamp(t / (durationInFrames / fps));
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const T = props.times as Times;
  const L = props.labels as Labels;
  const pcx = P.x + P.w / 2;
  const tear = ease((t - T.tear) / 0.9);
  const m = ease((t - T.result + 0.4) / 1);
  const tearPts = boltPoints(pcx, P.y, pcx - 30, P.y + P.h, 9, 23, 140);
  const half = (edge: number, dir: number) => [[edge, P.y], ...tearPts, [edge, P.y + P.h]].map(([x, y]) => `${x! + dir * tear * 640},${y}`).join(' ');
  const [cx, cy] = pic.focus ?? [0.5, 0.5];
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0} flash={strikeAt(t, [T.tear])}>
        <Cover src={pic.src} box={{x: 0, y: 0, w: P.w - 20, h: P.h - 20}} cx={cx} cy={cy} zoom={1.06 + 0.06 * k} filter={`brightness(${0.85 + 0.5 * strikeAt(t, [T.tear])})`} />
      </Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <defs><clipPath id={`${id}p`}><rect x={P.x} y={P.y} width={P.w} height={P.h} rx={look.measures.plateRadius + 2} /></clipPath></defs>
        <g clipPath={`url(#${id}p)`}>
          <polygon points={half(P.x, -1)} fill={c.backdrop} opacity={0.94} />
          <polygon points={half(P.x + P.w, 1)} fill={c.backdrop} opacity={0.94} />
          <LightLine look={look} d={ptsPath(tearPts)} op={strikeAt(t, [T.tear - 0.05]) * 1.2 + 0.5 * (1 - tear) * ramp(t, T.tear - 0.6, T.tear - 0.1)} width={4} />
          {/* the bolt is alive: it crawls in the dark before the tear, then keeps striking over the picture */}
          <LiveBolt look={look} t={t} x0={pcx + 220 * Math.sin(t * 0.7)} y0={P.y} x1={pcx - 160 + 120 * Math.sin(t * 0.5)} y1={P.y + P.h * 0.9}
            op={ramp(t, 0, 0.4) * (1 - ramp(t, T.tear - 0.1, T.tear)) * (0.6 + 0.4 * strikeAt(t, [1.2 + Math.floor(t / 1.4) * 1.4]))} grow={clamp(t / 1.2)} seed={3} />
          {[0, 1, 2, 3, 4, 5].map((j) => {
            const tj = T.tear + 1.6 + j * 2.6 + rnd(j) * 0.8;
            const xx = P.x + 160 + rnd(j + 9) * (P.w - 320);
            return <LiveBolt key={j} look={look} t={t} x0={xx} y0={P.y} x1={xx + (rnd(j + 4) - 0.5) * 300} y1={P.y + P.h * (0.35 + rnd(j + 2) * 0.2)} op={strikeAt(t, [tj])} grow={clamp((t - tj) / 0.12)} seed={j * 7} />;
          })}
        </g>
        <g transform={`translate(0 ${m * 150})`}><GlassChip look={look} fonts={fonts} x={pcx} y={P.y + 150} text={L.a} op={ramp(t, T.a, T.a + 0.3) * (1 - m)} size={44} /></g>
        <g transform={`translate(0 ${-m * 150})`}><GlassChip look={look} fonts={fonts} x={pcx} y={P.y + 450} text={L.b} op={ramp(t, T.b, T.b + 0.3) * (1 - m)} size={44} /></g>
        <GlassChip look={look} fonts={fonts} x={pcx} y={P.y + 300} text={L.verb} sub={L.verbSub} op={win(t, T.verb - 0.1, T.result + 0.2)} size={40} color={c.highlight} />
        <GlassChip look={look} fonts={fonts} x={pcx} y={P.y + 300} text={L.result} op={ramp(t, T.result, T.result + 0.4) * (1 - ramp(t, T.end - 0.4, T.end - 0.1))} size={48} color={c.glow} />
      </svg>
    </AbsoluteFill>
  );
};

const Label = z.string().min(1).max(22);

export const kit: KitVersion = {
  name: 'merge',
  version: '1.0.0',
  description: "The figure tool for two things fused into one, on the 16:9 panel: the dark tears along a line of light on the picture, bolts strike, the two words meet in the result, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** The first word, the second, the tear, the verb, the result, and when the chips leave. */
    times: z.object({a: z.number(), b: z.number(), tear: z.number(), verb: z.number(), result: z.number(), end: z.number()}).strict()
      .refine((x) => x.b >= x.a && x.verb < x.result && x.result < x.end, {message: 'the second word follows the first, and the verb comes before the result, before the end'}),
    labels: z.object({a: Label, b: Label, verb: Label, verbSub: z.string().min(1).max(30).optional(), result: Label}).strict(),
  }).strict(),
  component: Merge,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}, focus: [0.5, 0.4]}, times: {a: 0.6, b: 1.1, tear: 1.8, verb: 3, result: 4.2, end: 6}, labels: {a: 'SKY', b: 'EARTH', verb: 'SHOWED', verbSub: 'one verb for both', result: 'ONE WORLD'}};
    return [
      {id: 'words', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 180, frame: 40},
      {id: 'torn', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 180, frame: 100},
      {id: 'result', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 180, frame: 150},
    ];
  })(),
};
````

Create `packages/remotion-composer/src/kits/cards/1.0.0.tsx`:

````tsx
// cards@1.0.0 — released: never edit this file; add cards/<next>.tsx instead.
// The figure tool for a thing given a body (from CreativeStudio's
// poesie-museo-long specimen «cards»): wind blows across the hall, the picture
// breathes, up to three cards slide in on its right — an icon, a word and its
// meaning — and the last one jolts the picture; then the human words stack on
// the left. It draws its own glass panel. Channel-neutral: the look is a prop
// (ADR-0040).
import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, plateStyle, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {clamp, ease, ramp, rnd, win} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, type Box} from '../lib/lesson-stage/1.0.0.js';
import {PANEL, PictureSchema, SvgText, Wind, back, fitLine, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Card {word: string; gloss: string; icon: string; pulse?: boolean; at: number}

const Cards: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const cards = props.cards as Card[];
  const times = props.times as {human: number; end: number};
  const human = (props.human as string[] | undefined) ?? [];
  const first = cards[0]!.at;
  const last = cards.at(-1)!.at;
  const breath = 1 + 0.03 * Math.sin(t * 2.8) * ramp(t, first, first + 0.4);
  const jolt = (rnd(Math.floor(t * 22)) - 0.5) * 10 * win(t, last, last + 2, 0.1);
  const [cx, cy] = pic.focus ?? [0.5, 0.5];
  const out = 1 - ramp(t, times.end - 0.4, times.end);
  const wordSize = fitSize({family: look.fonts.sans, weight: 600}, cards.map((x) => x.word), 530 - 126 - 24, 44, (s) => s * 0.07);
  const glossSize = fitSize({family: look.fonts.serif, weight: 400, style: 'italic'}, cards.map((x) => x.gloss), 530 - 126 - 24, 30);
  const humanSize = fitLine({family: look.fonts.display, weight: 400}, human, 420, 54, () => 2, (s) => s * 0.64 + 24);
  return (
    <AbsoluteFill>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}><Wind look={look} t={t} opacity={0.5 * ramp(t, 0, 1)} strength={1.2} y0={80} y1={1000} /></svg>
      <Glass look={look} box={P} t={t} tilt={0}>
        <div style={{position: 'absolute', inset: 0, transform: `translateY(${jolt}px)`}}>
          <Cover src={pic.src} box={{x: 0, y: 0, w: P.w - 20, h: P.h - 20}} cx={cx} cy={cy} zoom={1.08 * breath} filter="saturate(1.15)" />
        </div>
        <div style={{position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${alpha(c.backdrop, 0)} 40%, ${alpha(c.backdrop, 0.6)})`, opacity: ramp(t, first - 0.3, first + 0.1) * out}} />
      </Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        {cards.map((card, j) => {
          const y = P.y + 60 + j * 170;
          const x = P.x + P.w - 560;
          const show = ramp(t, card.at, card.at + 0.35) * out;
          const icx = x + 66;
          const icy = y + 64;
          return (
            <g key={j} opacity={show} transform={`translate(${(1 - back((t - card.at) / 0.45)) * 90} 0)`}>
              <rect x={x} y={y} width={530} height={140} rx={14} fill={alpha(c.plate, 0.9)} stroke={alpha(c.text, 0.65)} strokeWidth="1.2" />
              {card.icon === 'bruise' ? (
                <circle cx={icx} cy={icy} r={28 + 3 * Math.sin(t * 2)} fill={alpha(c.lightning, 0.55)} stroke={c.lightning} strokeWidth="2" />
              ) : (
                <g>
                  <circle cx={icx} cy={icy} r={40} fill={alpha(c.accent, 0.25)} stroke={c.accent} strokeWidth="2.5" />
                  <g transform={card.pulse ? `translate(${icx} ${icy}) scale(${1 + 0.08 * Math.sin(t * 5)}) translate(${-icx} ${-icy})` : undefined}>
                    <foreignObject x={icx - 28} y={icy - 28} width={56} height={56}><Img src={card.icon} style={{width: 56, height: 56, objectFit: 'contain'}} /></foreignObject>
                  </g>
                </g>
              )}
              <SvgText look={look} fonts={fonts} x={x + 126} y={y + 62} size={wordSize} weight={600} ls={wordSize * 0.07}>{card.word}</SvgText>
              <SvgText look={look} fonts={fonts} x={x + 126} y={y + 108} size={glossSize} role="serif" italic color={c.glow}>{card.gloss}</SvgText>
            </g>
          );
        })}
      </svg>
      <div style={{position: 'absolute', left: P.x + 44, top: P.y + 60, width: 420, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6}}>
        {human.map((h, j) => {
          const a = times.human + 0.15 * j;
          const e = ease((t - a) / 0.55);
          return (
            <div key={j} style={{display: 'inline-block', padding: '.12em .32em .16em', ...plateStyle(look), fontFamily: fonts.display, fontSize: humanSize, letterSpacing: 2, lineHeight: 1.08, whiteSpace: 'nowrap',
              color: j ? c.highlight : c.text, textShadow: look.measures.textShadow, opacity: clamp((t - a) / 0.3) * out, transform: `translateY(${(1 - e) * 14}px)`}}>{h}</div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'cards',
  version: '1.0.0',
  description: "The figure tool for a thing given a body, on the 16:9 panel: wind blows, up to three cards slide in — icon, word, meaning — the last one jolting the picture, and the human words stack beside them, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** Each card's icon is a picture, or "bruise" (a drawn bruise). */
    cards: z.array(z.object({word: z.string().min(1).max(14), gloss: z.string().min(1).max(30), icon: z.union([AssetUrl, z.literal('bruise')]), pulse: z.boolean().optional(), at: z.number()}).strict()).min(1).max(3)
      .refine((cs) => cs.every((x, i) => i === 0 || x.at >= cs[i - 1]!.at), {message: 'the cards come one after the other'}),
    /** The human words, stacked on the left from `times.human`. */
    human: z.array(z.string().min(1).max(20)).max(4).optional(),
    /** When the human words come, and when the cards and words leave. */
    times: z.object({human: z.number(), end: z.number()}).strict(),
  }).strict(),
  component: Cards,
  examples: ((): KitExample[] => {
    const cards = [
      {word: 'GASPING', gloss: 'out of breath', icon: {$asset: 'icon'}, pulse: true, at: 0.4},
      {word: 'LIVID', gloss: 'bruised, dark blue', icon: 'bruise', at: 1},
      {word: 'IN TURMOIL', gloss: 'shaken from within', icon: {$asset: 'icon'}, at: 1.6},
    ];
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}}, cards, human: ['A BODY', 'THAT SUFFERS'], times: {human: 2.4, end: 5}};
    return [
      {id: 'three-cards', props: base, samples: {a: 'picture-a.png', icon: 'figure.png'}, durationInFrames: 180, frame: 100},
      {id: 'arriving', props: base, samples: {a: 'picture-a.png', icon: 'figure.png'}, durationInFrames: 180, frame: 36},
      {id: 'long', props: {...base, cards: [{word: 'MMMMMMMMMMMMMM', gloss: 'a gloss of thirty characters!!', icon: 'bruise', at: 0}], human: ['MMMMMMMMMMMMMMMMMMMM']}, samples: {a: 'picture-a.png'}, durationInFrames: 120, frame: 90},
    ];
  })(),
};
````

Create `packages/remotion-composer/src/kits/stack/1.0.0.tsx`:

````tsx
// stack@1.0.0 — released: never edit this file; add stack/<next>.tsx instead.
// The figure tool for a climax (from CreativeStudio's poesie-museo-long
// specimen «stack»): three words in a row as they are first read; then a
// staircase, each word a step heavier than the one before, a gauge of their
// weight filling; at the collapse the picture shatters into shards that fly
// into the hall, smoke rises and the glass is rebuilt, dimmed. It draws its
// own glass panel. Channel-neutral: the look is a prop (ADR-0040).
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {COLOR_ROLES, DEMO_LOOK, LookSchema, alpha, type ColorRole, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {clamp, ease, ramp, rnd} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, LoopClip, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {PANEL, PictureSchema, Shards, Smoke, SvgText, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Step {word: string; gloss: string; color?: ColorRole}
interface Times {w1: number; w2: number; w3: number; stairs: number; s1: number; s2: number; s3: number; collapse: number}

const Stack: KitVersion['component'] = ({props, context}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const T = props.times as Times;
  const steps = props.steps as Step[];
  const row = (props.row as string[] | undefined) ?? steps.map((s) => s.word);
  const clip = props.clip as string | undefined;
  const labels = props.labels as {weight: string};
  const inner: Box = {x: 0, y: 0, w: P.w - 20, h: P.h - 20};
  const [cx, cy] = pic.focus ?? [0.5, 0.5];
  const DEFAULT: ColorRole[] = ['glow', 'highlight', 'signal'];
  const colOf = (j: number) => c[steps[j]!.color ?? DEFAULT[j]!];
  const firstRead = [T.w1, T.w2, T.w3];
  const second = [T.s1, T.s2, T.s3];
  const toStairs = ease((t - T.stairs + 0.2) / 0.7);
  const fall = (j: number) => clamp((t - T.collapse - 0.05 - j * 0.12) / 1.1);
  const shatter = clamp((t - T.collapse) / 1.6);
  const rebuilt = ramp(t, T.collapse + 1.7, T.collapse + 2.2);
  const weight = t < T.s1 ? 0 : t < T.s2 ? 1 / 3 : t < T.s3 ? 2 / 3 : 1;
  const wk = ease((t - second[Math.max(0, Math.round(weight * 3) - 1)]!) / 0.5);
  const level = weight - (1 / 3) * (1 - wk) * (weight > 0 ? 1 : 0);
  const grade = `brightness(${1 - 0.3 * ramp(t, T.s2, T.s2 + 0.4) + strikeAt(t, [T.s2]) * 0.8}) saturate(${1 + 0.3 * ramp(t, T.s2, T.s2 + 0.4)}) contrast(1.1)`;
  const jolt = (rnd(Math.floor(t * 25)) - 0.5) * 14 * strikeAt(t, [T.s2]);
  const fallen = t >= T.collapse;
  const rowSize = fitSize({family: look.fonts.display, weight: 400}, row, (P.w - 80 - 2 * 56) / 3, 68, (s) => s * 0.04);
  const bw = Math.min(280, (P.w - 200) / 3 - 20);
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0} flash={strikeAt(t, [T.s2]) + strikeAt(t, [T.collapse])}>
        {!fallen ? (
          <>
            <div style={{position: 'absolute', inset: 0, transform: `translateX(${jolt}px)`}}><Cover src={pic.src} box={inner} cx={cx} cy={cy} zoom={1.08} filter={grade} /></div>
            {clip ? <div style={{position: 'absolute', inset: 0, mixBlendMode: 'screen', opacity: 0.25 * ramp(t, T.w1, T.w1 + 0.6) + 0.4 * ramp(t, T.s1, T.s1 + 0.5)}}><LoopClip src={clip} box={inner} live={1} frames={context.assetFrames[clip]} filter="contrast(1.2)" /></div> : null}
          </>
        ) : (
          <div style={{position: 'absolute', inset: 0, background: c.backdrop}}>
            {clip ? <div style={{position: 'absolute', inset: 0, opacity: 0.8 * (1 - rebuilt * 0.5)}}><LoopClip src={clip} box={inner} live={1} frames={context.assetFrames[clip]} filter="brightness(1.3) contrast(1.1)" /></div> : null}
          </div>
        )}
        <div style={{position: 'absolute', inset: 0, background: `linear-gradient(0deg, ${alpha(c.backdrop, 0.8)}, ${alpha(c.backdrop, 0.1)} 70%)`, opacity: toStairs * (1 - ramp(t, T.collapse, T.collapse + 0.3))}} />
      </Glass>
      {fallen && shatter < 1 ? <div style={{position: 'absolute', inset: 0}}><Shards look={look} src={pic.src} box={{x: P.x + 10, y: P.y + 10, w: inner.w, h: inner.h}} k={ease(shatter)} cx={cx} cy={cy} zoom={1.08} filter={grade} /></div> : null}
      {rebuilt > 0 ? <Glass look={look} box={P} t={t} tilt={0} on={rebuilt}><Cover src={pic.src} box={inner} cx={cx} cy={0.2} zoom={1.1} filter="brightness(.55) saturate(.8)" /></Glass> : null}
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <defs><marker id={`${id}a`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill={c.highlight} /></marker></defs>
        <rect x={P.x + 40} y={P.y + P.h - 190} width={P.w - 80} height={120} rx={16} fill={alpha(c.plate, 0.92)} opacity={ramp(t, T.w1 - 0.1, T.w1 + 0.2) * (1 - toStairs)} />
        {toStairs > 0 ? steps.map((s, j) => {
          const bx = P.x + 60 + j * (bw + 20);
          const top = P.y + P.h - 150 - j * 120;
          const h = P.y + P.h - 10 - top;
          const rise = ease((t - second[j]! + 0.15) / 0.45);
          const f = fall(j);
          const nominal = 50 + j * 12;
          const size = fitSize({family: look.fonts.display, weight: 400}, [s.word], bw + 40, nominal, (x) => x * 0.04);
          const glossSize = fitSize({family: look.fonts.sans, weight: 600}, [s.gloss], bw - 20, 28);
          return (
            <g key={j} opacity={toStairs * (1 - ramp(t, T.collapse + 1.2, T.collapse + 1.6))} transform={`translate(${f * (j - 1) * 220} ${f * f * 900}) rotate(${f * (j - 1.2) * 40} ${bx + bw / 2} ${top})`}>
              <rect x={bx} y={top + h * (1 - rise)} width={bw} height={h * rise} rx={8} fill={alpha(c.text, 0.16)} stroke={colOf(j)} strokeWidth="2.5" />
              <g opacity={rise}>
                <SvgText look={look} fonts={fonts} x={bx + bw / 2} y={top - 22} size={size} anchor="middle" role="display" color={colOf(j)} ls={size * 0.04}>{s.word}</SvgText>
                <SvgText look={look} fonts={fonts} x={bx + bw / 2} y={top + 48} size={glossSize} anchor="middle" weight={600}>{s.gloss}</SvgText>
              </g>
            </g>
          );
        }) : null}
        {toStairs > 0 && t < T.collapse + 0.2 ? (
          <path d={`M${P.x + 80} ${P.y + P.h - 220} L${P.x + P.w * 0.62} ${P.y + 130}`} stroke={c.highlight} strokeWidth="5" strokeDasharray="8 10" fill="none" opacity={ramp(t, T.s1, T.s1 + 0.4)} strokeDashoffset={-t * 30} markerEnd={`url(#${id}a)`} />
        ) : null}
        {toStairs > 0 ? (
          <g opacity={toStairs * (1 - ramp(t, T.collapse, T.collapse + 0.3))}>
            <rect x={P.x + P.w - 70} y={P.y + 120} width={34} height={400} rx={17} fill={alpha(c.plate, 0.92)} stroke={alpha(c.text, 0.7)} />
            <rect x={P.x + P.w - 66} y={P.y + 516 - 392 * level} width={26} height={392 * level} rx={13} fill={weight > 0.9 ? colOf(2) : weight > 0.5 ? colOf(1) : colOf(0)} />
            <SvgText look={look} fonts={fonts} x={P.x + P.w - 53} y={P.y + 100} size={26} anchor="middle" weight={600}>{labels.weight}</SvgText>
          </g>
        ) : null}
        <g opacity={ramp(t, T.collapse + 0.2, T.collapse + 0.7)}><Smoke look={look} t={t} box={{x: 300, y: 760, w: 1400, h: 200}} opacity={0.5 * (1 - ramp(t, T.collapse + 3, T.collapse + 4))} /></g>
        <rect x={P.x} y={P.y} width={P.w} height={P.h} fill="#fff" opacity={strikeAt(t, [T.collapse - 0.02]) * 0.7} />
      </svg>
      <div style={{position: 'absolute', left: P.x + 40, top: P.y + P.h - 190, width: P.w - 80, height: 120, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 56, opacity: 1 - toStairs}}>
        {row.map((w, j) => <div key={j} style={{fontFamily: fonts.display, fontSize: rowSize, letterSpacing: rowSize * 0.04, color: c.text, textShadow: look.measures.textShadow, whiteSpace: 'nowrap', opacity: ramp(t, firstRead[j]! - 0.05, firstRead[j]! + 0.2)}}>{w}</div>)}
      </div>
    </AbsoluteFill>
  );
};

const Word = z.string().min(1).max(20);

export const kit: KitVersion = {
  name: 'stack',
  version: '1.0.0',
  description: "The figure tool for a climax, on the 16:9 panel: three words in a row, then a staircase of growing weight with its gauge, then the picture shatters, smoke rises and the glass is rebuilt dimmed, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** The three words of the climax, lightest first; colours default to glow, highlight, signal. */
    steps: z.array(z.object({word: Word, gloss: z.string().min(1).max(24), color: z.enum(COLOR_ROLES).optional()}).strict()).length(3),
    /** The words of the row, as first read (default the steps' words). */
    row: z.array(Word).length(3).optional(),
    /** A clip of clouds blended over the picture, then left behind it after the collapse. */
    clip: AssetUrl.optional(),
    labels: z.object({weight: z.string().min(1).max(10)}).strict(),
    /** The row's words, the staircase, its steps, the collapse. */
    times: z.object({w1: z.number(), w2: z.number(), w3: z.number(), stairs: z.number(), s1: z.number(), s2: z.number(), s3: z.number(), collapse: z.number()}).strict()
      .refine((x) => x.w1 <= x.w2 && x.w2 <= x.w3 && x.w3 < x.stairs && x.stairs <= x.s1 && x.s1 < x.s2 && x.s2 < x.s3 && x.s3 < x.collapse, {message: 'the row, the staircase, its steps and the collapse come in order'}),
  }).strict(),
  component: Stack,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}}, steps: [{word: 'CLUTTERED', gloss: 'full'}, {word: 'TRAGIC', gloss: 'heavy'}, {word: 'WORN', gloss: 'broken'}], labels: {weight: 'WEIGHT'},
      times: {w1: 0.3, w2: 0.7, w3: 1.1, stairs: 2, s1: 2.3, s2: 3, s3: 3.7, collapse: 5}};
    return [
      {id: 'row', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 45},
      {id: 'stairs', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 130},
      {id: 'shattering', props: {...base, clip: {$asset: 'clip'}}, samples: {a: 'picture-a.png', clip: 'clip.mp4'}, durationInFrames: 240, frame: 168},
      {id: 'rebuilt', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 230},
    ];
  })(),
};
````

Create `packages/remotion-composer/src/kits/oxymoron/1.0.0.tsx`:

````tsx
// oxymoron@1.0.0 — released: never edit this file; add oxymoron/<next>.tsx instead.
// The figure tool for an oxymoron (from CreativeStudio's poesie-museo-long
// specimen «oxymoron»): a glow on a point of the picture with its chip; the
// panel splits into two halves, a calm word over a calm wave and its opposite
// over an agitated one; the picture lights up and goes dark as two words light
// up; the conjunction that is missing appears, struck out. It draws its own
// glass panel. Channel-neutral: the look is a prop (ADR-0040).
import React, {useId} from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ramp, win} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, strikeAt, type Box} from '../lib/lesson-stage/1.0.0.js';
import {GlassChip, LightTitle, PANEL, PictureSchema, SvgText, Tag, coverPoint, wavePath, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Times {glow: number; a: number; b: number; on: number; off: number; noConj: number}
interface Labels {glow: string; glowSub?: string; a: string; aSub?: string; b: string; bSub?: string; on: string; off: string; conj: string; noConj: string}
const ZOOM = 1.08;

const Oxymoron: KitVersion['component'] = ({props}) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const {fps, durationInFrames} = useVideoConfig();
  const t = useCurrentFrame() / fps;
  const end = durationInFrames / fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const T = props.times as Times;
  const L = props.labels as Labels;
  const [hx, hy] = props.house as [number, number];
  const [cx, cy] = pic.focus ?? [0.5, 0.5];
  const IN: Box = {x: P.x + 10, y: P.y + 10, w: P.w - 20, h: P.h - 20};
  const [px, py] = coverPoint(IN, pic.aspect ?? 4 / 3, 1, cx, cy, ZOOM, hx, hy);
  const pcx = P.x + P.w / 2;
  const light = t < T.on ? 1 : t < T.off ? 1.55 : t < T.off + 2.3 ? 0.15 : 1;
  const split = ramp(t, T.a, T.a + 0.4) * (1 - ramp(t, T.on - 0.4, T.on));
  const half = P.w / 2 - 80;
  const wordSize = fitSize({family: look.fonts.sans, weight: 200}, [L.a, L.b], half, 72, (s) => s * 0.11);
  const subSize = fitSize({family: look.fonts.sans, weight: 400}, [L.aSub ?? '', L.bSub ?? ''], half, 26, () => 4);
  const lightSize = fitSize({family: look.fonts.sans, weight: 200}, [L.on, L.off], 380, 84, (s) => s * 0.04);
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0} flash={strikeAt(t, [T.on])}>
        <Cover src={pic.src} box={{x: 0, y: 0, w: IN.w, h: IN.h}} cx={cx} cy={cy} zoom={ZOOM} filter={`brightness(${light})`} />
      </Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <defs>
          <radialGradient id={`${id}g`}><stop offset="0" stopColor={c.highlight} stopOpacity=".75" /><stop offset=".5" stopColor={c.highlight} stopOpacity=".25" /><stop offset="1" stopColor={c.highlight} stopOpacity="0" /></radialGradient>
          <clipPath id={`${id}p`}><rect x={P.x} y={P.y} width={P.w} height={P.h} rx={look.measures.plateRadius + 2} /></clipPath>
        </defs>
        <circle cx={px} cy={py} r={110 + 14 * Math.sin(t * 4)} fill={`url(#${id}g)`} opacity={ramp(t, T.glow, T.glow + 0.4) * (1 - ramp(t, T.a, T.a + 0.4))} />
        <GlassChip look={look} fonts={fonts} x={px} y={Math.max(P.y + 70, py - 140)} text={L.glow} sub={L.glowSub} op={ramp(t, T.glow + 0.3, T.glow + 0.6) * (1 - ramp(t, T.a - 0.2, T.a + 0.1))} size={30} />
        <g opacity={split} clipPath={`url(#${id}p)`}>
          <rect x={P.x} y={P.y} width={P.w / 2} height={P.h} fill={alpha(c.backdrop, 0.78)} />
          <rect x={pcx} y={P.y} width={P.w / 2} height={P.h} fill={alpha(c.signal, 0.25)} />
          <rect x={pcx} y={P.y} width={P.w / 2} height={P.h} fill={alpha(c.backdrop, 0.6)} />
          <SvgText look={look} fonts={fonts} x={P.x + P.w / 4} y={P.y + 170} size={wordSize} anchor="middle" weight={200} ls={wordSize * 0.11}>{L.a}</SvgText>
          {L.aSub ? <SvgText look={look} fonts={fonts} x={P.x + P.w / 4} y={P.y + 220} size={subSize} anchor="middle" ls={4} color={c.textDim}>{L.aSub}</SvgText> : null}
          <path d={wavePath(P.x + 60, P.y + 360, P.w / 2 - 120, 4, t, 0)} stroke={c.glow} strokeWidth="3" fill="none" />
          <g opacity={ramp(t, T.b, T.b + 0.3)}>
            <SvgText look={look} fonts={fonts} x={P.x + P.w * 0.75} y={P.y + 170} size={wordSize} anchor="middle" weight={200} ls={wordSize * 0.11} color={c.signal}>{L.b}</SvgText>
            {L.bSub ? <SvgText look={look} fonts={fonts} x={P.x + P.w * 0.75} y={P.y + 220} size={subSize} anchor="middle" ls={4} color={c.textDim}>{L.bSub}</SvgText> : null}
            <path d={wavePath(pcx + 60, P.y + 360, P.w / 2 - 120, 80, t * 1.6, 1)} stroke={c.signal} strokeWidth="3" fill="none" />
          </g>
        </g>
        <LightTitle look={look} fonts={fonts} t={t} at={T.on} x={pcx - 200} y={P.y + 140} size={lightSize} text={L.on} weight={200} color={c.highlight} until={end + 1} />
        <LightTitle look={look} fonts={fonts} t={t} at={T.off} x={pcx + 210} y={P.y + 140} size={lightSize} text={L.off} weight={200} until={end + 1} />
        {t > T.noConj ? (
          <g opacity={win(t, T.noConj, T.noConj + 3.4)}>
            <SvgText look={look} fonts={fonts} x={pcx} y={P.y + 330} size={120} anchor="middle" role="serif" italic>{L.conj}</SvgText>
            <path d={`M${pcx - 55} ${P.y + 340} L${pcx + 55} ${P.y + 250}`} stroke={c.signal} strokeWidth="6" strokeLinecap="round" strokeDasharray="150" strokeDashoffset={150 * (1 - ramp(t, T.noConj + 0.2, T.noConj + 0.5))} />
            <Tag look={look} fonts={fonts} x={pcx} y={P.y + 420} anchor="middle" text={L.noConj} color={c.signal} />
          </g>
        ) : null}
      </svg>
    </AbsoluteFill>
  );
};

const Word = z.string().min(1).max(16);
const Sub = z.string().min(1).max(30);

export const kit: KitVersion = {
  name: 'oxymoron',
  version: '1.0.0',
  description: "The figure tool for an oxymoron, on the 16:9 panel: a glow on a point of the picture, two halves with a calm and an agitated wave, the picture lighting up and going dark, the missing conjunction struck out, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** The point of the picture (0–1) that glows. */
    house: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    times: z.object({glow: z.number(), a: z.number(), b: z.number(), on: z.number(), off: z.number(), noConj: z.number()}).strict()
      .refine((x) => x.glow <= x.a && x.a <= x.b && x.b < x.on && x.on <= x.off && x.off <= x.noConj, {message: 'the glow, the two halves, the light on and off and the conjunction come in order'}),
    labels: z.object({glow: z.string().min(1).max(20), glowSub: Sub.optional(), a: Word, aSub: Sub.optional(), b: Word, bSub: Sub.optional(), on: Word, off: Word, conj: z.string().min(1).max(4), noConj: z.string().min(1).max(24)}).strict(),
  }).strict(),
  component: Oxymoron,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}, aspect: 4 / 3}, house: [0.63, 0.61],
      times: {glow: 0.3, a: 1.5, b: 2, on: 3.2, off: 3.8, noConj: 4.6},
      labels: {glow: 'THE HOUSE', glowSub: 'white, white', a: 'SILENT', aSub: 'no sound', b: 'TUMULT', bSub: 'all the noise', on: 'APPEARED', off: 'VANISHED', conj: 'and', noConj: 'NO CONJUNCTION'}};
    return [
      {id: 'glow', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 30},
      {id: 'halves', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 80},
      {id: 'struck', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 240, frame: 160},
    ];
  })(),
};
````

Create `packages/remotion-composer/src/kits/simile/1.0.0.tsx`:

````tsx
// simile@1.0.0 — released: never edit this file; add simile/<next>.tsx instead.
// The figure tool for a simile (from CreativeStudio's poesie-museo-long
// specimen «simile»): the frame closes in on an eye in the picture and its
// iris comes alive; a plate gives a word's etymology; the bridge — a drawn
// eye, "like", and the compared thing — darkens the picture; the eyelids
// open and close as two words light up; at the end the whole frame goes dark.
// It draws its own glass panel. Channel-neutral: the look is a prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ease, ramp, win} from '../lib/stage-math/1.0.0.js';
import {AssetUrl, BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Cover, Glass, type Box} from '../lib/lesson-stage/1.0.0.js';
import {Eyelids, IrisLive, LightTitle, PANEL, PictureSchema, SvgText, coverPoint, type Picture} from '../lib/lesson-tools/1.0.0.js';

interface Times {subject: number; etym: number; like: number; open: number; close: number; dark: number}
interface Labels {etymWord?: string; etymOrigin?: string; etymMeaning?: string; like: string; open: string; close: string}

const Simile: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const pic = props.picture as Picture;
  const T = props.times as Times;
  const L = props.labels as Labels;
  const eye = props.eye as {x: number; y: number; r?: number};
  const bridgeImage = props.bridgeImage as string | undefined;
  const aspect = pic.aspect ?? 4 / 3;
  const inner: Box = {x: 0, y: 0, w: P.w - 20, h: P.h - 20};
  const zoom = 1.08 + 0.7 * ease((t - T.subject) / 1.6) * (1 - ease((t - T.like) / 0.8)) + 0.7 * ease((t - T.open + 0.6) / 1);
  // the eye is the frame's focus: it stays where it is while the frame closes in
  const [ex, ey] = coverPoint(inner, aspect, 1, eye.x, eye.y, zoom, eye.x, eye.y);
  const r = coverPoint(inner, aspect, 1, eye.x, eye.y, zoom, eye.x + (eye.r ?? 0.148), eye.y)[0] - ex;
  let open = 1;
  if (t > T.close) open = 1 - ease((t - T.close) / 0.45);
  else if (t > T.open - 0.6 && t < T.open) open = 0.15 + 0.85 * ease((t - T.open + 0.6) / 0.6);
  const bridge = win(t, T.like - 0.1, T.open - 0.6);
  const pcx = P.x + P.w / 2;
  const etymSize = fitSize({family: look.fonts.sans, weight: 300}, [L.etymWord ?? ''], 600 - 72, 52, () => 2);
  const etymSub = fitSize({family: look.fonts.serif, weight: 400, style: 'italic'}, [L.etymOrigin ?? ''], 600 - 72, 30);
  const etymMeaning = fitSize({family: look.fonts.sans, weight: 400}, [L.etymMeaning ?? ''], 600 - 72, 26, () => 3);
  const wordSize = fitSize({family: look.fonts.sans, weight: 200}, [L.open, L.close], P.w - 120, 72, (s) => s * 0.04);
  const dark = ease(t - T.dark) * 0.95;
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0}>
        <Cover src={pic.src} box={inner} cx={eye.x} cy={eye.y} zoom={zoom} />
        <IrisLive t={t} src={pic.src} box={inner} cx={eye.x} cy={eye.y} zoom={zoom} ex={ex} ey={ey} r={r} op={open * (1 - bridge)} />
        <svg viewBox={`0 0 ${inner.w} ${inner.h}`} style={{position: 'absolute', inset: 0, width: inner.w, height: inner.h}}><Eyelids look={look} open={open} cx={ex} cy={ey} w={1500} /></svg>
        <div style={{position: 'absolute', inset: 0, background: alpha(c.backdrop, 0.8), opacity: bridge}} />
        {bridge > 0 && bridgeImage ? <Img src={bridgeImage} style={{position: 'absolute', left: 70, top: 150, width: 320, height: 240, objectFit: 'contain', opacity: bridge}} /> : null}
      </Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        {L.etymWord ? (
          <g opacity={win(t, T.etym, T.like - 0.1)}>
            <rect x={P.x + 50} y={P.y + 70} width={600} height={190} rx={14} fill={alpha(c.plate, 0.92)} stroke={alpha(c.text, 0.7)} />
            <SvgText look={look} fonts={fonts} x={P.x + 86} y={P.y + 140} size={etymSize} weight={300} ls={2}>{L.etymWord}</SvgText>
            {L.etymOrigin ? <SvgText look={look} fonts={fonts} x={P.x + 86} y={P.y + 190} size={etymSub} role="serif" italic color={c.glow}>{L.etymOrigin}</SvgText> : null}
            {L.etymMeaning ? <SvgText look={look} fonts={fonts} x={P.x + 86} y={P.y + 236} size={etymMeaning} ls={3} color={c.textDim}>{L.etymMeaning}</SvgText> : null}
          </g>
        ) : null}
        <g opacity={bridge}>
          <g transform={`translate(${P.x + P.w - 260} ${P.y + 280})`}>
            <path d="M-170 0 Q0 -120 170 0 Q0 120 -170 0 Z" fill={alpha(c.text, 0.9)} stroke={c.glow} strokeWidth="3" />
            <circle r={62} fill={c.accent} /><circle r={30} fill={c.ink} /><circle cx={18} cy={-20} r={10} fill="#fff" />
          </g>
          <line x1={P.x + 420} y1={P.y + 290} x2={P.x + 420 + 240 * ramp(t, T.like, T.like + 0.6)} y2={P.y + 290} stroke={c.highlight} strokeWidth="2" />
          <LightTitle look={look} fonts={fonts} t={t} at={T.like} x={pcx - 10} y={P.y + 270} size={64} text={L.like} weight={200} color={c.highlight} />
        </g>
        <LightTitle look={look} fonts={fonts} t={t} at={T.open} x={P.x + 60} y={P.y + 140} size={wordSize} text={L.open} anchor="start" weight={200} color={c.highlight} until={T.dark} />
        <LightTitle look={look} fonts={fonts} t={t} at={T.close} x={P.x + 60} y={P.y + 230} size={wordSize} text={L.close} anchor="start" weight={200} until={T.dark} />
      </svg>
      {dark > 0 ? <AbsoluteFill style={{background: '#000', opacity: dark}} /> : null}
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'simile',
  version: '1.0.0',
  description: "The figure tool for a simile, on the 16:9 panel: the frame closes in on an eye whose iris comes alive, an etymology plate, the bridge with a drawn eye and \"like\", eyelids opening and closing, then the whole frame going dark, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    picture: PictureSchema,
    /** The eye on the picture (0–1), and its iris's radius as a share of the picture's width. */
    eye: z.object({x: z.number().min(0).max(1), y: z.number().min(0).max(1), r: z.number().positive().max(0.5).optional()}).strict(),
    times: z.object({subject: z.number(), etym: z.number(), like: z.number(), open: z.number(), close: z.number(), dark: z.number()}).strict()
      .refine((x) => x.subject <= x.etym && x.etym < x.like && x.like < x.open && x.open < x.close && x.close < x.dark, {message: 'the subject, the etymology, the bridge, the eye opening and closing and the dark come in order'}),
    labels: z.object({etymWord: z.string().min(1).max(20).optional(), etymOrigin: z.string().min(1).max(40).optional(), etymMeaning: z.string().min(1).max(40).optional(),
      like: z.string().min(1).max(12), open: z.string().min(1).max(16), close: z.string().min(1).max(16)}).strict(),
    /** The compared thing, shown in the bridge. */
    bridgeImage: AssetUrl.optional(),
  }).strict(),
  component: Simile,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, picture: {src: {$asset: 'a'}, aspect: 4 / 3}, eye: {x: 0.5, y: 0.3},
      times: {subject: 0.2, etym: 1.8, like: 3.4, open: 5.4, close: 6.2, dark: 7.2},
      labels: {etymWord: 'STARTLED', etymOrigin: 'from the old word for fear', etymMeaning: 'WIDE OPEN WITH FEAR', like: 'LIKE', open: 'OPENED', close: 'CLOSED'}};
    return [
      {id: 'iris', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 270, frame: 45},
      {id: 'etymology', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 270, frame: 75},
      {id: 'bridge', props: {...base, bridgeImage: {$asset: 'b'}}, samples: {a: 'picture-a.png', b: 'picture-b.png'}, durationInFrames: 270, frame: 125},
      {id: 'closing', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 270, frame: 200},
      {id: 'darkening', props: base, samples: {a: 'picture-a.png'}, durationInFrames: 270, frame: 228},
    ];
  })(),
};
````

In `src/kits/index.ts`, import them after `progress100`:

```ts
import {kit as merge100} from './merge/1.0.0.js';
import {kit as cards100} from './cards/1.0.0.js';
import {kit as stack100} from './stack/1.0.0.js';
import {kit as oxymoron100} from './oxymoron/1.0.0.js';
import {kit as simile100} from './simile/1.0.0.js';
```

and add a line to `KIT_VERSIONS` after the narrative tools' line:

```ts
  merge100, cards100, stack100, oxymoron100, simile100,
```

- [ ] **Step 3: Lock, previews, tests**

Run: `npm run kits:lock`. The new entries must be exactly:

```json
  "cards@1.0.0": "sha256:09b8eee1f449ff1215b9cfa30e3772a997f61da16c5b8450c678d582b063c797",
  "merge@1.0.0": "sha256:33d18c09091dd81393b62390bb8a3bfc4649037b07fce0ee3c45c97d06370f75",
  "oxymoron@1.0.0": "sha256:f4d1097f98ac6309449c5afea1c1102c4f8c2b164b4cce1ba6f84a440cd6aaca",
  "simile@1.0.0": "sha256:fc5043b3fdef765eac636e652da147feb4b0e8674ad514e43e29ea0cc3ffff05",
  "stack@1.0.0": "sha256:f35f8a9545ea95eeab297b5f6c1a129ea998e8d64d030beab5364d657015e075",
```

```bash
git -C "$(git rev-parse --show-toplevel)" checkout d555e4d -- \
  packages/remotion-composer/previews/merge@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/cards@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/stack@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/oxymoron@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/simile@1.0.0.youtube-1920x1080.png
```

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/merge/1.0.0.tsx \
  packages/remotion-composer/src/kits/cards/1.0.0.tsx \
  packages/remotion-composer/src/kits/stack/1.0.0.tsx \
  packages/remotion-composer/src/kits/oxymoron/1.0.0.tsx \
  packages/remotion-composer/src/kits/simile/1.0.0.tsx \
  packages/remotion-composer/previews/merge@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/cards@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/stack@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/oxymoron@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/simile@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/src/kits/index.ts packages/remotion-composer/test/validate.test.ts packages/remotion-composer/kits.lock.json
git commit -m "The figure tools: merge, cards, stack, oxymoron, simile, each drawing its own glass panel (avg-dcf.4.2.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The metre (avg-dcf.4.2.2)

**Files:**
- Create: the two kits below, and their two `previews/*.youtube-1920x1080.png`.
- Modify: `packages/remotion-composer/src/kits/index.ts`, `test/validate.test.ts`, `kits.lock.json`.

**Interfaces:**
- Consumes: Task 1's library (`LightTitle`, `PANEL`, `SvgText`); `lib/lesson-stage` (`Glass`).
- Produces: the kits `syllables@1.0.0`, `rhymes@1.0.0`.

- [ ] **Step 1: Write the failing tests**

In `packages/remotion-composer/test/validate.test.ts`:

1. In "refuses malformed teaching tools at their paths", add after the `stack` assertion:

```ts
    const sylTimes = {sample: 0, vowel: 1, breath: 2, figure: 3, metric: 4};
    const sylLabels = {counted: 'C', metric: 'M', rule: 'R', ruleResult: 'RR'};
    assert.deepEqual(refused('syllables', {syllables: ['a', 'b', 'c'], merges: [{a: 0, b: 2, label: 'ac', vowels: 'a', text: 't', at: 1}], metric: 2, times: sylTimes, labels: sylLabels}), at('merges[0].b'));
    assert.deepEqual(refused('rhymes', {ends: ['a', 'b'], scheme: 'AA', pair: [0, 2], title: 'T', label: 'L', times: {rhymes: 0, a: 1, b: 2, close: 3}}), at('pair'));
```

2. Make the listing:

```ts
    assert.deepEqual(listKits(ids).map((k) => [k.name, k.version, k.layer]), [
      ['block-title', '1.0.0', 'overlay'],
      ['brand-mark', '1.0.0', 'overlay'],
      ['brand-mark', '2.0.0', 'overlay'],
      ['captions', '1.0.0', 'fill'],
      ['captions', '1.1.0', 'overlay'],
      ['cards', '1.0.0', 'fill'],
      ['chapter-opener', '1.0.0', 'fill'],
      ['clip', '1.0.0', 'fill'],
      ['cover', '1.0.0', 'fill'],
      ['figure-title', '1.0.0', 'overlay'],
      ['interlinear', '1.0.0', 'overlay'],
      ['interprete', '1.0.0', 'fill'],
      ['interprete', '1.1.0', 'fill'],
      ['lower-third', '1.0.0', 'overlay'],
      ['merge', '1.0.0', 'fill'],
      ['monitor-wall', '1.0.0', 'fill'],
      ['museum-hall', '1.0.0', 'fill'],
      ['oxymoron', '1.0.0', 'fill'],
      ['panel', '1.0.0', 'fill'],
      ['panel', '1.1.0', 'fill'],
      ['progress', '1.0.0', 'overlay'],
      ['rhymes', '1.0.0', 'fill'],
      ['room', '1.0.0', 'fill'],
      ['room-effect', '1.0.0', 'fill'],
      ['simile', '1.0.0', 'fill'],
      ['stack', '1.0.0', 'fill'],
      ['still', '1.0.0', 'fill'],
      ['story-fx', '1.0.0', 'fill'],
      ['summary', '1.0.0', 'fill'],
      ['syllables', '1.0.0', 'fill'],
      ['text-stack', '1.0.0', 'overlay'],
      ['timeline', '1.0.0', 'fill'],
      ['title-chip', '1.0.0', 'overlay'],
      ['verse-bar', '1.0.0', 'overlay'],
      ['verse-plate', '1.0.0', 'overlay'],
      ['warp', '1.0.0', 'fill'],
      ['word-tracks', '1.0.0', 'fill'],
    ]);
```

Run: `cd packages/remotion-composer && node --import tsx --test test/validate.test.ts`
Expected: FAIL (the metre kits do not exist).

- [ ] **Step 2: The kits**

Create `packages/remotion-composer/src/kits/syllables/1.0.0.tsx`:

````tsx
// syllables@1.0.0 — released: never edit this file; add syllables/<next>.tsx instead.
// The metre lesson's count (from CreativeStudio's poesie-museo-long «metrica»):
// a verse's syllables as tiles, one by one; arcs over the vowels that meet
// between two words; the rule and what follows from it; the tiles closing up
// as the vowels merge, each merge written out; the count falling to the
// metric syllables, and the figure's name. Channel-neutral: the look is a
// prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ease, ramp} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Glass, type Box} from '../lib/lesson-stage/1.0.0.js';
import {LightTitle, PANEL, SvgText} from '../lib/lesson-tools/1.0.0.js';

interface Merge {a: number; b: number; label: string; vowels: string; text: string; at: number}
interface Times {sample: number; vowel: number; breath: number; figure: number; metric: number}
interface Labels {counted: string; metric: string; rule: string; ruleResult: string; figure?: string}

const Syllables: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const syl = props.syllables as string[];
  const merges = (props.merges as Merge[] | undefined) ?? [];
  const metric = props.metric as number;
  const T = props.times as Times;
  const L = props.labels as Labels;
  const gap = 8;
  const tileW = Math.min(66, (P.w - 140) / syl.length - gap);
  const x0 = P.x + 70;
  const mk = merges.map((m) => ease((t - m.at) / 0.8));
  const tiles = syl.map((s, i) => ({s, i, x: x0 + (i - merges.reduce((sh, m, j) => sh + (i >= m.b ? mk[j]! : 0), 0)) * (tileW + gap)}));
  const shown = T.sample + 0.8 + syl.length * 0.1 + 0.3;
  const count = t < shown ? null : t < T.metric - 0.2 ? Math.round(syl.length - mk.reduce((s, x) => s + x, 0)) : metric;
  const tileSize = fitSize({family: look.fonts.sans, weight: 400}, [...syl, ...merges.map((m) => m.label)], tileW - 10, 30);
  const ruleSize = fitSize({family: look.fonts.sans, weight: 300}, [L.rule], P.w - 140 - 260, 26);
  const resultSize = fitSize({family: look.fonts.sans, weight: 400}, [L.ruleResult], P.w - 140 - 260, 30);
  const mergeSize = fitSize({family: look.fonts.serif, weight: 400, style: 'italic'}, merges.map((m) => m.text), P.w - 140 - 260, 40);
  const figSize = fitSize({family: look.fonts.sans, weight: 200}, [L.figure ?? ''], P.w - 140, 56, (s) => s * 0.04);
  const capSize = fitSize({family: look.fonts.sans, weight: 400}, [L.counted, L.metric], 420, 26, () => 4);
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0}><div style={{position: 'absolute', inset: 0, background: `radial-gradient(900px 500px at 40% 40%, ${alpha(c.accent, 0.3)}, ${alpha(c.backdrop, 0.85)})`}} /></Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        {tiles.map(({s, i, x}) => {
          const j = merges.findIndex((m) => i === m.a || i === m.b);
          const m = j < 0 ? 0 : mk[j]!;
          const isB = j >= 0 && i === merges[j]!.b;
          const hot = j >= 0 && t > T.vowel;
          const label = j >= 0 && i === merges[j]!.a && m > 0.5 ? merges[j]!.label : s;
          return (
            <g key={i} opacity={ramp(t, T.sample + 0.8 + i * 0.1, T.sample + 1 + i * 0.1) * (isB ? 1 - m : 1)} transform={`translate(${x} ${P.y + 150})`}>
              <rect width={tileW} height={tileW} rx={10} fill={hot ? alpha(c.lightning, 0.35) : alpha(c.text, 0.12)} stroke={hot ? c.lightning : alpha(c.text, 0.7)} strokeWidth="1.3" />
              <SvgText look={look} fonts={fonts} x={tileW / 2} y={tileW * 0.64} size={tileSize} anchor="middle">{label}</SvgText>
            </g>
          );
        })}
        {merges.map((mg, j) => {
          const xa = tiles[mg.a]!.x + tileW * 0.8;
          const xc = tiles[mg.b]!.x + tileW * 0.2;
          return (
            <g key={j} opacity={ramp(t, T.vowel + j * 0.3, T.vowel + 0.4 + j * 0.3) * (1 - mk[j]!)}>
              <path d={`M${xa} ${P.y + 140} Q${(xa + xc) / 2} ${P.y + 90} ${xc} ${P.y + 140}`} stroke={c.lightning} strokeWidth="3" fill="none" />
              <SvgText look={look} fonts={fonts} x={(xa + xc) / 2} y={P.y + 100} size={22} anchor="middle" color={c.lightning}>{mg.vowels}</SvgText>
            </g>
          );
        })}
        <g opacity={ramp(t, T.vowel, T.vowel + 0.4)}>
          <SvgText look={look} fonts={fonts} x={x0} y={P.y + 360} size={ruleSize} weight={300} color={c.textDim}>{L.rule}</SvgText>
          <SvgText look={look} fonts={fonts} x={x0} y={P.y + 405} size={resultSize} color={c.glow} op={ramp(t, T.breath, T.breath + 0.3)}>{L.ruleResult}</SvgText>
        </g>
        {merges.map((mg, j) => <LightTitle key={j} look={look} fonts={fonts} t={t} at={mg.at} x={x0} y={P.y + 480 + 55 * j} size={mergeSize} text={mg.text} anchor="start" role="serif" italic weight={400} color={c.highlight} />)}
        {count !== null ? (
          <g transform={`translate(${P.x + P.w - 70} ${P.y + 520})`}>
            <SvgText look={look} fonts={fonts} x={0} y={0} size={150} anchor="end" weight={200} color={count === metric ? c.highlight : c.text}>{count}</SvgText>
            <SvgText look={look} fonts={fonts} x={0} y={36} size={capSize} anchor="end" ls={4} color={c.textDim}>{count === metric ? L.metric : L.counted}</SvgText>
          </g>
        ) : null}
        {L.figure ? <LightTitle look={look} fonts={fonts} t={t} at={T.figure} x={P.x + P.w - 70} y={P.y + 330} size={figSize} text={L.figure} anchor="end" weight={200} color={c.lightning} /> : null}
      </svg>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'syllables',
  version: '1.0.0',
  description: "The metre lesson's count on the 16:9 panel: a verse's syllables as tiles, arcs over the vowels that meet, the rule, the tiles closing up as they merge, the count falling to the metric syllables, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    /** The verse's syllables, counted one by one. */
    syllables: z.array(z.string().min(1).max(6)).min(2).max(20),
    /** Where two syllables merge into one: `b` is the syllable after `a`. */
    merges: z.array(z.object({a: z.number().int().min(0), b: z.number().int().min(1), label: z.string().min(1).max(8), vowels: z.string().min(1).max(8), text: z.string().min(1).max(40), at: z.number()}).strict()).max(2).optional(),
    /** The count once the vowels have merged. */
    metric: z.number().int().positive(),
    times: z.object({sample: z.number(), vowel: z.number(), breath: z.number(), figure: z.number(), metric: z.number()}).strict(),
    labels: z.object({counted: z.string().min(1).max(40), metric: z.string().min(1).max(40), rule: z.string().min(1).max(60), ruleResult: z.string().min(1).max(60), figure: z.string().min(1).max(20).optional()}).strict(),
  }).strict().superRefine((p, ctx) => {
    (p.merges ?? []).forEach((m, j) => {
      if (m.b !== m.a + 1 || m.b >= p.syllables.length) ctx.addIssue({code: 'custom', message: 'a merge joins a syllable with the next one', path: ['merges', j, 'b']});
    });
  }),
  component: Syllables,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, syllables: ['la', 'ter', 'ra', 'an', 'si', 'mo', 'sa', 'li', 'vi', 'da', 'in', 'sus', 'sul', 'to'],
      merges: [{a: 2, b: 3, label: 'ran', vowels: 'a + a', text: 'terra ansimosa → terransimosa', at: 3.4}, {a: 9, b: 10, label: 'din', vowels: 'a + i', text: 'livida in → lividin', at: 4.4}],
      metric: 12, times: {sample: 0, vowel: 2, breath: 2.6, figure: 5.4, metric: 6},
      labels: {counted: 'SYLLABLES COUNTED ONE BY ONE', metric: 'METRIC SYLLABLES', rule: 'ends with a vowel  +  starts with a vowel', ruleResult: '→ one breath, one syllable', figure: 'SYNALOEPHA'}};
    return [
      {id: 'counted', props: base, samples: {}, durationInFrames: 240, frame: 70},
      {id: 'merging', props: base, samples: {}, durationInFrames: 240, frame: 125},
      {id: 'metric', props: base, samples: {}, durationInFrames: 240, frame: 200},
    ];
  })(),
};
````

Create `packages/remotion-composer/src/kits/rhymes/1.0.0.tsx`:

````tsx
// rhymes@1.0.0 — released: never edit this file; add rhymes/<next>.tsx instead.
// The metre lesson's rhymes (from CreativeStudio's poesie-museo-long
// «metrica»): the last word of each verse with its letter in the rhyme
// scheme; a pair lights up and an arc joins them; their name lights; an eye
// opens and closes. Channel-neutral: the look is a prop (ADR-0040).
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {KitExample, KitVersion} from '../types.js';
import {DEMO_LOOK, LookSchema, alpha, type Look} from '../lib/look/1.0.0.js';
import {useLookFonts} from '../lib/fonts/1.1.0.js';
import {fitSize} from '../lib/font-metrics/1.0.0.js';
import {ease, ramp} from '../lib/stage-math/1.0.0.js';
import {BoxSchema} from '../lib/stage-props/1.0.0.js';
import {Glass, type Box} from '../lib/lesson-stage/1.0.0.js';
import {LightTitle, PANEL, SvgText} from '../lib/lesson-tools/1.0.0.js';

interface Times {rhymes: number; a: number; b: number; close: number}

const Rhymes: KitVersion['component'] = ({props}) => {
  const look = props.look as Look;
  const fonts = useLookFonts(look.fonts);
  const c = look.colors;
  const t = useCurrentFrame() / useVideoConfig().fps;
  const P = (props.box as Box | undefined) ?? PANEL;
  const ends = props.ends as string[];
  const scheme = props.scheme as string;
  const [pa, pb] = props.pair as [number, number];
  const T = props.times as Times;
  const DY = Math.min(58, 400 / ends.length);
  const Y = (i: number) => P.y + 160 + i * DY;
  const endSize = fitSize({family: look.fonts.serif, weight: 400, style: 'italic'}, ends, 300, Math.min(38, DY * 0.7));
  const titleSize = fitSize({family: look.fonts.sans, weight: 300}, [props.title as string], P.w - 140, 44, (s) => s * 0.04);
  const labelSize = fitSize({family: look.fonts.sans, weight: 200}, [props.label as string], P.w - 640 - 40, 70, (s) => s * 0.04);
  const shut = 1 - ease((t - T.close - 0.6) / 0.5);
  return (
    <AbsoluteFill>
      <Glass look={look} box={P} t={t} tilt={0}><div style={{position: 'absolute', inset: 0, background: `radial-gradient(900px 500px at 40% 40%, ${alpha(c.accent, 0.3)}, ${alpha(c.backdrop, 0.85)})`}} /></Glass>
      <svg viewBox="0 0 1920 1080" style={{position: 'absolute', inset: 0, width: 1920, height: 1080}}>
        <LightTitle look={look} fonts={fonts} t={t} at={T.rhymes} x={P.x + 70} y={P.y + 100} size={titleSize} text={props.title as string} anchor="start" weight={300} />
        {ends.map((e, i) => {
          const lit = (i === pa && t > T.a) || (i === pb && t > T.b);
          return (
            <g key={i} opacity={ramp(t, T.rhymes + i * 0.12, T.rhymes + 0.25 + i * 0.12)}>
              <SvgText look={look} fonts={fonts} x={P.x + 380} y={Y(i)} size={endSize} role="serif" italic anchor="end" color={lit ? c.highlight : c.text}>{e}</SvgText>
              <circle cx={P.x + 420} cy={Y(i) - 12} r={16} fill={lit ? c.highlight : alpha(c.text, 0.2)} stroke={alpha(c.text, 0.7)} />
              <text x={P.x + 420} y={Y(i) - 5} fontSize={20} fontFamily={fonts.sans} fontWeight={600} textAnchor="middle" fill={lit ? c.ink : c.text}>{scheme[i]}</text>
            </g>
          );
        })}
        <path d={`M${P.x + 445} ${Y(pa) - 12} Q${P.x + 760} ${(Y(pa) + Y(pb)) / 2 - 12} ${P.x + 445} ${Y(pb) - 12}`} stroke={c.highlight} strokeWidth="4" fill="none" strokeDasharray="900" strokeDashoffset={900 * (1 - ease((t - T.b) / 0.9))} />
        <LightTitle look={look} fonts={fonts} t={t} at={T.b + 0.5} x={P.x + 640} y={P.y + 340} size={labelSize} text={props.label as string} anchor="start" weight={200} color={c.highlight} />
        {t > T.close ? (
          <g transform={`translate(${P.x + 820} ${P.y + 470})`} opacity={ramp(t, T.close, T.close + 0.3)}>
            <path d={`M-110 0 Q0 ${-80 * shut} 110 0 Q0 ${80 * shut} -110 0 Z`} fill={alpha(c.text, 0.9)} stroke={c.highlight} strokeWidth="3" />
            <circle r={36 * shut} fill={c.ink} />
          </g>
        ) : null}
      </svg>
    </AbsoluteFill>
  );
};

export const kit: KitVersion = {
  name: 'rhymes',
  version: '1.0.0',
  description: "The metre lesson's rhymes on the 16:9 panel: the last word of each verse with its scheme letter, a rhyming pair lit and joined by an arc, its name, an eye closing, in the channel theme's look.",
  profiles: ['youtube-1920x1080'],
  props: z.object({
    look: LookSchema,
    box: BoxSchema.optional(),
    /** The last word of each verse. */
    ends: z.array(z.string().min(1).max(20)).min(2).max(10),
    /** One letter per verse (ABCBCCA). */
    scheme: z.string().regex(/^[A-Z]+$/),
    /** The two verses whose rhyme is shown. */
    pair: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    title: z.string().min(1).max(30),
    label: z.string().min(1).max(24),
    times: z.object({rhymes: z.number(), a: z.number(), b: z.number(), close: z.number()}).strict()
      .refine((x) => x.rhymes <= x.a && x.a <= x.b && x.b <= x.close, {message: 'the rhymes, the pair and the eye come in order'}),
  }).strict().superRefine((p, ctx) => {
    if (p.scheme.length !== p.ends.length) ctx.addIssue({code: 'custom', message: 'one scheme letter per verse', path: ['scheme']});
    if (!(p.pair[0] < p.pair[1] && p.pair[1] < p.ends.length)) ctx.addIssue({code: 'custom', message: 'the pair is two of the verses, in order', path: ['pair']});
  }),
  component: Rhymes,
  examples: ((): KitExample[] => {
    const base = {look: DEMO_LOOK, ends: ['were', 'turmoil', 'worn', 'tumult', 'flash', 'startled', 'night'], scheme: 'ABCBCCA', pair: [0, 6], title: 'THE RHYMES', label: 'FIRST AND LAST',
      times: {rhymes: 0, a: 1.2, b: 2, close: 3.6}};
    return [
      {id: 'pair', props: base, samples: {}, durationInFrames: 180, frame: 100},
      {id: 'closing', props: base, samples: {}, durationInFrames: 180, frame: 140},
    ];
  })(),
};
````

In `src/kits/index.ts`, import them after `simile100`:

```ts
import {kit as syllables100} from './syllables/1.0.0.js';
import {kit as rhymes100} from './rhymes/1.0.0.js';
```

and end the figure tools' line in `KIT_VERSIONS` with them:

```ts
  merge100, cards100, stack100, oxymoron100, simile100, syllables100, rhymes100,
```

- [ ] **Step 3: Lock, previews, tests**

Run: `npm run kits:lock`. The new entries must be exactly:

```json
  "rhymes@1.0.0": "sha256:106c0efb40aba3b705ee0209b4c36c4bccacc025c9389a5829a63b6ad4afc173",
  "syllables@1.0.0": "sha256:43a5c7bdaad19773c2574000c02ce376368fcf5c0114bae3be9f8b21841f43b1",
```

```bash
git -C "$(git rev-parse --show-toplevel)" checkout d555e4d -- \
  packages/remotion-composer/previews/syllables@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/rhymes@1.0.0.youtube-1920x1080.png
```

Run: `npx tsc --noEmit && npm test`
Expected: PASS, 392 tests.

- [ ] **Step 4: Commit**

```bash
git add packages/remotion-composer/src/kits/syllables/1.0.0.tsx \
  packages/remotion-composer/src/kits/rhymes/1.0.0.tsx \
  packages/remotion-composer/previews/syllables@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/previews/rhymes@1.0.0.youtube-1920x1080.png \
  packages/remotion-composer/src/kits/index.ts packages/remotion-composer/test/validate.test.ts packages/remotion-composer/kits.lock.json
git commit -m "The metre: syllables closing up into the metric count, rhymes joined by their arc (avg-dcf.4.2.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The sixteen held to the themes, and the README

**Files:**
- Modify: `studio/series/test/theme-alignment.test.ts`, `packages/remotion-composer/README.md`.

- [ ] **Step 1: The alignment test**

````diff
diff --git a/studio/series/test/theme-alignment.test.ts b/studio/series/test/theme-alignment.test.ts
index e766b79..a6a041f 100644
--- a/studio/series/test/theme-alignment.test.ts
+++ b/studio/series/test/theme-alignment.test.ts
@@ -24,10 +24,12 @@ test("the contract allows exactly the font families the composer bundles", () =>
   assert.deepEqual(Object.keys(BUNDLED_FONTS).sort(), [...BUNDLED_FAMILIES].sort());
 });
 
-test("the neutral kits are the lesson stage's ten", () => {
+test("the neutral kits are the lesson stage's ten and the teaching tools' sixteen", () => {
   assert.deepEqual(neutral.map((k) => `${k.name}@${k.version}`).sort(), [
-    "block-title@1.0.0", "brand-mark@2.0.0", "chapter-opener@1.0.0", "cover@1.0.0", "figure-title@1.0.0",
-    "interprete@1.1.0", "panel@1.0.0", "room@1.0.0", "verse-bar@1.0.0", "warp@1.0.0",
+    "block-title@1.0.0", "brand-mark@2.0.0", "cards@1.0.0", "chapter-opener@1.0.0", "cover@1.0.0", "figure-title@1.0.0",
+    "interlinear@1.0.0", "interprete@1.1.0", "merge@1.0.0", "monitor-wall@1.0.0", "oxymoron@1.0.0", "panel@1.0.0", "panel@1.1.0",
+    "progress@1.0.0", "rhymes@1.0.0", "room@1.0.0", "simile@1.0.0", "stack@1.0.0", "story-fx@1.0.0", "summary@1.0.0",
+    "syllables@1.0.0", "text-stack@1.0.0", "timeline@1.0.0", "verse-bar@1.0.0", "warp@1.0.0", "word-tracks@1.0.0",
   ]);
 });
 
````

Run: `npm run build --workspace @av/remotion-composer && cd studio/series && node --import tsx --test test/theme-alignment.test.ts`
Expected: PASS. Every theme's look draws in every example of all sixteen.

To see that it bites, temporarily change `"accent"` in `studio/series/fixtures/themes/dentro-i-versi/1.0.0/theme.json` to `"cyan"`: the "draws in every neutral kit" test must fail. Then restore it (`git diff --exit-code studio/series/fixtures`).

- [ ] **Step 2: The README**

````diff
diff --git a/packages/remotion-composer/README.md b/packages/remotion-composer/README.md
index 3493b79..25d77c1 100644
--- a/packages/remotion-composer/README.md
+++ b/packages/remotion-composer/README.md
@@ -77,6 +77,37 @@ loops, storm, live bolt, teleport, warp). A look's fonts must be bundled
 families with the faces their role is drawn with (display 400, serif 400
 italic, sans 400 and 600).
 
+The lesson's teaching tools are channel-neutral in the same way, drawn for
+`youtube-1920x1080` with times in seconds from the item's start and every text
+a prop. Narrative tools are layers the compiler places over and under the
+panel; the figure tools and the metre kits draw their own glass panel
+(default box 440/150/1060×596), because their effects work on the picture.
+
+| Kit | Layer | What it draws |
+|---|---|---|
+| `panel@1.1.0` | fill | The glass panel as stacked layers per phase: a picture, 2–4 pictures side by side, a clip, a grid of light, a darkening, a portrait beside a dark grid, a framed picture; each shaded or dimmed |
+| `text-stack@1.0.0` | overlay | A column of texts — big numbers, years, titles, chips, quotes, kickers, notes, rows, spaces — each at its time, room reserved so nothing overlaps |
+| `timeline@1.0.0` | fill | An axis of years whose stops light up (labels on as many lines as they need), or a row of dated stops |
+| `story-fx@1.0.0` | fill | Story effects over the panel: people lighting up, a curving arrow, a badge, a live bolt, a line of light |
+| `word-tracks@1.0.0` | fill | One track per verse, one pill per word, punctuation as light, a reading cursor, the tracks merging into one sentence |
+| `interlinear@1.0.0` | overlay | A translation word under word; struck words crossed out in the signal colour and closed up |
+| `monitor-wall@1.0.0` | fill | A grid of 1–8 glass monitors appearing one after another, a caption on a plate under them |
+| `summary@1.0.0` | fill | One row per picture (thumbnail, keyword, figure), a closing line, a flash lighting them all |
+| `progress@1.0.0` | overlay | Where the lesson is among its pictures, on a plate above the panel |
+| `merge@1.0.0` | fill | Two things fused into one: the dark tears along a line of light, bolts strike, the two words meet in the result |
+| `cards@1.0.0` | fill | A thing given a body: wind, up to three cards (icon, word, meaning), the last jolting the picture, the human words stacked |
+| `stack@1.0.0` | fill | A climax: three words in a row, a staircase of growing weight with its gauge, the picture shattering, smoke, the glass rebuilt dimmed |
+| `oxymoron@1.0.0` | fill | A glow on a point of the picture, calm and agitated halves, the picture lit and darkened, the missing conjunction struck out |
+| `simile@1.0.0` | fill | The frame closing in on an eye whose iris lives, an etymology plate, the bridge with "like", eyelids opening and closing, the frame going dark |
+| `syllables@1.0.0` | fill | A verse's syllables as tiles, arcs over meeting vowels, the rule, the tiles closing up, the count falling to the metric syllables |
+| `rhymes@1.0.0` | fill | The verses' last words with their scheme letters, a rhyming pair joined by an arc, an eye closing |
+
+They draw with `lib/lesson-tools/1.0.0.tsx`: glass chips and tags, titles
+that light up, SVG text with a dark outline, waves, eyelids, the living iris,
+shards, wind, smoke, lines of light, `coverPoint` (where a point of a picture
+lands once framed: the figure tools take the picture's `aspect`), `fitLine`
+(a line fitted with its plate's room) and the figure tools' `PictureSchema`.
+
 ## Adding a kit or a version
 
 A released version never changes: a delivered episode must re-render as it
````

- [ ] **Step 3: The series suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS, 138 tests.

- [ ] **Step 4: Commit**

```bash
git add studio/series/test/theme-alignment.test.ts packages/remotion-composer/README.md
git commit -m "The teaching tools held to every channel theme; the composer README (avg-dcf.4.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Whole-branch checks

- [ ] **Step 1:** Run `git diff --stat d555e4d HEAD -- packages studio`. It must show no difference. Anything else is a deviation from the plan: explain or fix it.
- [ ] **Step 2:** From the root, run `npm run check && npm run docs:build`. Expected: PASS.
- [ ] **Step 3:** No commit. Report the test counts, the sixteen lock entries, and that no existing lock entry changed.
