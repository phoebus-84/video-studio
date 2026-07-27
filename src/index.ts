// ── studio-graphics-renderer ──
// Deterministic local renderer for text-critical visual assets.
//
// Public API surface:
//   models/    – GraphicRenderRequest, GraphicRenderResult, and related types
//   pipeline/  – SVGRenderPipeline (main entry point)
//   hashing/   – computeContentHash, generateStableId, contentHashEquals
//   resolver/  – FontResolver and ImageResolver interfaces
//   theme/     – Design tokens, contrast checking, safe area profiles
//   font/      – Font registry with license metadata and diagnostics

export * from './models/index.js';
export * from './pipeline/index.js';
export * from './hashing/index.js';
export * from './resolver/index.js';
export * from './theme/index.js';
export * from './font/index.js';
