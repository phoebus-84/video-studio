// ---------------------------------------------------------------------------
// The studio's adapters, composed
// ---------------------------------------------------------------------------
// Adding an adapter is one descriptor and one line here. The conformance test
// (test/conformance.test.ts) then fails CI if it matches no built-in stage, or
// collides with an adapter already registered.
// ---------------------------------------------------------------------------

import type { StageAdapter } from "./descriptor.js";
import { AdapterDispatcher, AdapterRegistry } from "./registry.js";
import { illustrationsFromAssets } from "./adapters/illustrations.js";
import { narrationCaptions } from "./adapters/captions.js";
import { narrationTiming } from "./adapters/timing.js";
import { renderQa } from "./adapters/render-qa.js";
import { seriesCheck, seriesRender, seriesSheet, seriesTimeline } from "./adapters/series.js";

export const STUDIO_ADAPTERS: readonly StageAdapter[] = Object.freeze([
  illustrationsFromAssets,
  narrationCaptions,
  narrationTiming,
  renderQa,
  seriesTimeline,
  seriesCheck,
  seriesSheet,
  seriesRender,
]);

export function createStudioRegistry(): AdapterRegistry {
  return new AdapterRegistry(STUDIO_ADAPTERS);
}

/** The dispatcher every execution-service composition that performs stages uses. */
export function createStudioDispatcher(): AdapterDispatcher {
  return new AdapterDispatcher(createStudioRegistry());
}
