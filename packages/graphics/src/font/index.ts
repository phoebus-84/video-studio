// ── Font module ──

export {
  FontRegistry,
  createFontRegistry,
  BUNDLED_FONTS,
  LICENSES,
} from './registry.js';
export type {
  FontEntry,
  FontLicense,
  FontLicenseId,
  FontVariant,
  FontCoverage,
  FontRegistryOptions,
} from './registry.js';

export {
  checkCoverage,
  checkTextCoverage,
  coverageSummary,
  coverageRenderDiagnostics,
  findBlock,
} from './diagnostics.js';
export type {
  MissingGlyphResult,
  FontCoverageDiagnostic,
} from './diagnostics.js';
