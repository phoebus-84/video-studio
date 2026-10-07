// stage-props@1.0.0 — released: never edit this file; add stage-props/<next>.ts instead (ADR-0039).
// The props the stage kits share, so they are written and checked the same
// way everywhere: envelopes, the camera, the lightning flash, the screen.

import React from 'react';
import {z} from 'zod';
import {maxOf, rnd, sumOf, type Envelope} from '../stage-math/1.0.0.js';

export const EnvelopeSchema = z.object({
  from: z.number(),
  to: z.number(),
  rampIn: z.number().min(0),
  rampOut: z.number().min(0),
  amount: z.number(),
}).strict().refine((e) => e.to >= e.from, {message: 'an envelope ends after it starts'});

/** The hall's camera, shared by every layer inside it: zoom (summed) and shake (px, the strongest). */
export const CameraSchema = z.object({
  origin: z.tuple([z.number(), z.number()]),
  zoom: z.array(EnvelopeSchema),
  shake: z.array(EnvelopeSchema),
}).strict();
export type Camera = z.infer<typeof CameraSchema>;

/** Lightning instants that light up the hall, the screen and the actor. */
export const FlashSchema = z.object({strikes: z.array(z.number())}).strict();

export const BoxSchema = z.object({x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive()}).strict();

/** A `{ "$asset": "<id>" }` reference, as a timeline writes it (the kit receives its URL). */
export const AssetUrl = z.object({$asset: z.string().min(1)}).strict();

/** The camera's CSS transform at t: zoom about its origin, and a shake jittered 24 times a second. */
export const cameraStyle = (t: number, camera: Camera): React.CSSProperties => {
  const scale = 1 + sumOf(t, camera.zoom as Envelope[]);
  const shake = maxOf(t, camera.shake as Envelope[]);
  const sx = (rnd(Math.floor(t * 24)) - 0.5) * 2 * shake;
  const sy = (rnd(Math.floor(t * 24) + 7) - 0.5) * 1.2 * shake;
  return {transformOrigin: `${camera.origin[0]}px ${camera.origin[1]}px`, transform: `translate(${sx}px, ${sy}px) scale(${scale})`};
};
