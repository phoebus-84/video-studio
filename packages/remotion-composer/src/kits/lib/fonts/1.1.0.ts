// fonts@1.1.0 — released: never edit this file; add fonts/<next>.ts instead (ADR-0039, ADR-0040).
// Every bundled face (@fontsource 5.3.0, OFL), by family. A look names a
// family per role; useLookFonts loads only those families' faces, in the
// browser, before the first frame. A face that fails stops the render.

import {useEffect, useState} from 'react';
import {cancelRender, continueRender, delayRender} from 'remotion';

type Face = [weight: string, style: string, file: () => Promise<{default: string}>];
const FAMILIES: Record<string, Face[]> = {
  Anton: [['400', 'normal', () => import('@fontsource/anton/files/anton-latin-400-normal.woff2')]],
  Fraunces: [
    ['400', 'normal', () => import('@fontsource/fraunces/files/fraunces-latin-400-normal.woff2')],
    ['400', 'italic', () => import('@fontsource/fraunces/files/fraunces-latin-400-italic.woff2')],
    ['700', 'normal', () => import('@fontsource/fraunces/files/fraunces-latin-700-normal.woff2')],
    ['700', 'italic', () => import('@fontsource/fraunces/files/fraunces-latin-700-italic.woff2')],
  ],
  Inter: [
    ['200', 'normal', () => import('@fontsource/inter/files/inter-latin-200-normal.woff2')],
    ['300', 'normal', () => import('@fontsource/inter/files/inter-latin-300-normal.woff2')],
    ['400', 'normal', () => import('@fontsource/inter/files/inter-latin-400-normal.woff2')],
    ['600', 'normal', () => import('@fontsource/inter/files/inter-latin-600-normal.woff2')],
  ],
};
export const BUNDLED_FAMILIES = Object.keys(FAMILIES);

/** The CSS family a bundled family is registered under. */
export const cssFamily = (family: string): string => `Studio ${family}`;

const loading = new Map<string, Promise<void>>();
function loadFamily(family: string): Promise<void> {
  const faces = FAMILIES[family];
  if (!faces) return Promise.reject(new Error(`no bundled font family "${family}" (${BUNDLED_FAMILIES.join(', ')})`));
  let p = loading.get(family);
  if (!p) {
    p = Promise.all(faces.map(async ([weight, style, file]) => {
      const url = (await file()).default;
      const face = new FontFace(cssFamily(family), `url(${url}) format('woff2')`, {weight, style});
      await face.load();
      // FontFaceSet is set-like; the DOM typings here lack its add().
      (document.fonts as unknown as Set<FontFace>).add(face);
    })).then(() => undefined, (error: unknown) => {
      loading.delete(family);
      throw error;
    });
    loading.set(family, p);
  }
  return p;
}

/** Hold the frame until the look's families are loaded; their CSS families, by role. */
export function useLookFonts(fonts: {display: string; serif: string; sans: string}): {display: string; serif: string; sans: string} {
  const families = [...new Set([fonts.display, fonts.serif, fonts.sans])];
  const [handle] = useState(() => delayRender(`fonts@1.1.0 ${families.join(', ')}`));
  const key = families.join('|');
  useEffect(() => {
    Promise.all(families.map(loadFamily)).then(() => continueRender(handle), (error: unknown) => {
      cancelRender(error instanceof Error ? error : new Error(String(error)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, key]);
  return {display: cssFamily(fonts.display), serif: cssFamily(fonts.serif), sans: cssFamily(fonts.sans)};
}
