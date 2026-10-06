// Bundle the kit preview compositions straight from the TypeScript sources,
// so the one-frame tests need no build. Webpack must be told that the ESM
// `./x.js` specifiers name `./x.ts` / `./x.tsx` files, as TypeScript reads them.

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function bundlePreviews(outDir: string): Promise<string> {
  return bundle({
    entryPoint: path.join(packageRoot, 'src/preview-entry.ts'),
    publicDir: path.join(packageRoot, 'kits/samples'),
    outDir,
    webpackOverride: (config) => ({
      ...config,
      resolve: {...config.resolve, extensionAlias: {'.js': ['.tsx', '.ts', '.js']}},
    }),
  });
}
