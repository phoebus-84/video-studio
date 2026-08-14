// ── Render result models ──

import type { GraphicKind } from './request.js';
import type { ThemeProvenance } from '../theme/types.js';

// ── Diagnostic ──

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface RenderDiagnostic {
  /** Machine-readable diagnostic code, e.g. "font.missing" */
  code: string;
  /** Severity */
  level: DiagnosticLevel;
  /** Human-readable message (English, actionable) */
  message: string;
  /** Optional structured context for automated processing */
  context?: Record<string, unknown>;
}

// ── Render status ──

/**
 * Closed vocabulary for render outcome.
 * - `success`: Fully rendered with no degradation.
 * - `partial`: Rendered but with warnings or non-fatal fallbacks.
 * - `failed`: Could not produce any output SVG.
 */
export type RenderStatus = 'success' | 'partial' | 'failed';

// ── Result ──

export interface GraphicRenderResult {
  /** Stable opaque ID, e.g. "gr_01J..." */
  stableId: string;
  /** Canonical sha256-prefixed hash of the canonical request and environment */
  requestHash: string;
  /** The rendered SVG content as a string */
  svgContent: string;
  /** Output width (matches request width for success) */
  width: number;
  /** Output height (matches request height for success) */
  height: number;
  /** Kind from the originating request */
  kind: GraphicKind;
  /** Render outcome */
  status: RenderStatus;
  /** Wall-clock render duration in milliseconds */
  durationMs: number;
  /** Ordered diagnostics from the render pass */
  diagnostics: RenderDiagnostic[];
  /** ISO 8601 / RFC 3339 UTC timestamp with Z suffix */
  timestamp: string;
  /** Canonical sha256-prefixed hash of the SVG output, for integrity */
  svgHash: string;
  /** Theme provenance — identifies the resolved theme token set and its origin */
  themeProvenance: ThemeProvenance | null;
}
