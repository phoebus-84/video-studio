// fonts@1.0.0 — released: never edit this file; add fonts/<next>.ts instead (ADR-0039).
// Anton, Fraunces (italic, regular and bold) and Inter (300, 400, 600) from
// @fontsource (OFL), bundled with the composer: no network at render time.
// The files are imported only when a kit renders — in the browser, where the
// bundler made them URLs — and every frame waits for them.

import {useEffect, useState} from 'react';
import {continueRender, delayRender} from 'remotion';

export const ANTON = 'Studio Anton';
export const SERIF = 'Studio Fraunces';
export const SANS = 'Studio Inter';

type Face = [family: string, weight: string, style: string, file: () => Promise<{default: string}>];
const FACES: Face[] = [
  [ANTON, '400', 'normal', () => import('@fontsource/anton/files/anton-latin-400-normal.woff2')],
  [SERIF, '400', 'italic', () => import('@fontsource/fraunces/files/fraunces-latin-400-italic.woff2')],
  [SERIF, '700', 'italic', () => import('@fontsource/fraunces/files/fraunces-latin-700-italic.woff2')],
  [SANS, '300', 'normal', () => import('@fontsource/inter/files/inter-latin-300-normal.woff2')],
  [SANS, '400', 'normal', () => import('@fontsource/inter/files/inter-latin-400-normal.woff2')],
  [SANS, '600', 'normal', () => import('@fontsource/inter/files/inter-latin-600-normal.woff2')],
];

let loading: Promise<void> | null = null;

function loadAll(): Promise<void> {
  loading ??= Promise.all(FACES.map(async ([family, weight, style, file]) => {
    const url = (await file()).default;
    const face = new FontFace(family, `url(${url}) format('woff2')`, {weight, style});
    await face.load();
    // FontFaceSet is set-like; the DOM typings here lack its add().
    (document.fonts as unknown as Set<FontFace>).add(face);
  })).then(() => undefined);
  return loading;
}

/** Hold the frame until every face is loaded. */
export function useFonts(): void {
  const [handle] = useState(() => delayRender('fonts@1.0.0'));
  useEffect(() => {
    loadAll().then(() => continueRender(handle), (error: unknown) => {
      throw error instanceof Error ? error : new Error(String(error));
    });
  }, [handle]);
}
