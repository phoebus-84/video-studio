// What the bundle worker runs: the Remotion bundler, with the application's
// packages first for library kits. Also run in the calling thread where a
// worker cannot start.

import {bundle} from '@remotion/bundler';
import {resolveFromApplication} from './library-kits.js';

export interface BundleJob {
  entryPoint: string;
  withKits: boolean;
  publicDir: string;
  outDir: string;
}

export async function bundleCode(job: BundleJob): Promise<string> {
  return bundle({
    entryPoint: job.entryPoint, publicDir: job.publicDir, outDir: job.outDir,
    ...(job.withKits ? {webpackOverride: resolveFromApplication} : {}),
  });
}
