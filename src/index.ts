// ── studio-graphics-renderer ──
// Deterministic local renderer for text-critical visual assets.
//
// Public API surface:
//   models/    – GraphicRenderRequest, GraphicRenderResult, and related types
//   pipeline/  – SVGRenderPipeline (main entry point)
//   hashing/   – computeContentHash, generateStableId, contentHashEquals
//   resolver/  – FontResolver and ImageResolver interfaces

export * from './models/index.js';
export * from './pipeline/index.js';
export * from './hashing/index.js';
export * from './resolver/index.js';
