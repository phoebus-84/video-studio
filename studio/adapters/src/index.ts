// ---------------------------------------------------------------------------
// @studio/adapters public API
// ---------------------------------------------------------------------------

export type { StageAdapter, AdapterContext, AdapterRequirements } from "./descriptor.js";
export { AdapterRegistry, AdapterDispatcher, AdapterRegistryError } from "./registry.js";
export { STUDIO_ADAPTERS, createStudioRegistry, createStudioDispatcher } from "./studio.js";
export { loadNarrationManifest, naturalSceneOrder } from "./narration-manifest.js";
export type { NarrationTimingEntry, LoadedNarrationManifest } from "./narration-manifest.js";
