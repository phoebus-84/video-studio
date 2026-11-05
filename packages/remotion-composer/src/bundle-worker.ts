// A worker thread bundling a render's code (bundle-cache), so webpack never
// holds up the thread that talks to the other machines.

import {parentPort, workerData} from 'node:worker_threads';
import {bundleCode, type BundleJob} from './bundle-worker-code.js';

bundleCode(workerData as BundleJob).then(
  () => parentPort!.postMessage({ok: true}),
  (e: unknown) => parentPort!.postMessage({ok: false, message: e instanceof Error ? e.message : String(e)}),
);
