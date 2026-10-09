// A library kit (avg-d1x) built for the tests: a full-frame colour card with a
// line of text, compiled outside this package as `vpr kit seal` builds one —
// one CommonJS file, React, Remotion and zod left to the application.

import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

export const SAMPLE_KIT = (name: string, version: string) => `
import React from "react";
import { AbsoluteFill } from "remotion";
import { z } from "zod";
export const kit = {
  name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)},
  description: "A colour card from the library",
  props: z.object({ text: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/) }).strict(),
  component: ({ props }: { props: { text: string; color: string } }) =>
    <AbsoluteFill style={{ background: props.color, color: "#ffffff", fontSize: 96 }}>{props.text}</AbsoluteFill>,
  examples: [],
};
`;

/** Build the sample kit (or `source`) into `dir`/kit.cjs; its absolute path and "sha256:…". */
export async function buildLibraryKit(dir: string, options: {name?: string; version?: string; source?: string} = {}): Promise<{file: string; hash: string; bytes: Buffer}> {
  const esbuild = createRequire(import.meta.url)('esbuild') as typeof import('esbuild');
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, 'index.tsx'), options.source ?? SAMPLE_KIT(options.name ?? 'sample-card', options.version ?? '1.0.0'));
  const out = await esbuild.build({
    entryPoints: [path.join(dir, 'index.tsx')], bundle: true, format: 'cjs', platform: 'browser', write: false, jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'remotion', 'zod', '@av/remotion-composer'], logLevel: 'silent',
  });
  const bytes = Buffer.from(out.outputFiles[0]!.contents);
  const file = path.join(dir, 'kit.cjs');
  await writeFile(file, bytes);
  return {file, bytes, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`};
}

/**
 * A kit that draws with the composer's toolbox (avg-d1x phase 3): its fonts,
 * loaded once for every kit, and its stage maths, imported from the package
 * by version and left external, so it shares the application's copy.
 */
export const TOOLBOX_KIT = `
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { z } from "zod";
import { useLookFonts } from "@av/remotion-composer/kits/lib/fonts/1.1.0";
import { ease } from "@av/remotion-composer/kits/lib/stage-math/1.0.0";
export const kit = {
  name: "toolbox-card", version: "1.0.0",
  description: "A colour card with a title in the look's sans, drawn with the composer's toolbox",
  props: z.object({ text: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/) }).strict(),
  component: ({ props }: { props: { text: string; color: string } }) => {
    const fonts = useLookFonts({ display: "Anton", serif: "Fraunces", sans: "Inter" });
    const frame = useCurrentFrame();
    return <AbsoluteFill style={{ background: props.color, color: "#ffffff", fontFamily: fonts.sans, fontSize: 96, opacity: 0.5 + 0.5 * ease(frame / 30) }}>{props.text}</AbsoluteFill>;
  },
  examples: [],
};
`;
