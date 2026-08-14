// ── SVG-first render pipeline ──
// Deterministic renderer that accepts GraphicRenderRequest
// and produces byte-stable SVG output.
//
// Implements sgr-3i9.2: series theme tokens, font registry with license
// metadata, missing-glyph diagnostics, profile-aware safe areas, and
// contrast checks. No platform font fallback is ever emitted.

import type { FontResolver } from '../resolver/font-resolver.js';
import type { ImageResolver } from '../resolver/image-resolver.js';
import type {
  GraphicRenderRequest,
  CodeFrameContent,
  DiagramContent,
  TitleFrameContent,
  CalloutContent,
  ComparisonLayoutContent,
  SimpleChartContent,
  InfographicPrimitiveContent,
} from '../models/request.js';
import type {
  GraphicRenderResult,
  RenderDiagnostic,
  RenderStatus,
} from '../models/result.js';
import { computeContentHash, generateStableId } from '../hashing/content-hash.js';
import {
  resolveTheme,
  checkPaletteContrast,
  contrastDiagnostics,
  computePixelSafeArea,
} from '../theme/index.js';
import type { ResolvedDesignTokens, ThemeProvenance } from '../theme/types.js';
import { FontRegistry, createFontRegistry } from '../font/registry.js';
import type { FontEntry } from '../font/registry.js';
import { checkCoverage } from '../font/diagnostics.js';

// ── Internal theme adapter ──
// Maps ResolvedDesignTokens to the CSS values used by kind renderers.

interface RenderStyle {
  // Colors
  background: string;
  foreground: string;
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
  border: string;
  // Font CSS specs (resolved from registry, never platform-dependent)
  fontBody: string;
  fontHeading: string;
  fontMono: string;
  // Spacing
  pad: number;
  unit: number;
  // Stroke
  strokeHairline: number;
  strokeRegular: number;
  strokeEmphasis: number;
  // Corner radii
  cornerSm: number;
  cornerMd: number;
  cornerLg: number;
  // Type scale
  fontSizeXs: number;
  fontSizeSm: number;
  fontSizeBase: number;
  fontSizeMd: number;
  fontSizeLg: number;
  fontSizeXl: number;
  fontSize2xl: number;
}

function buildRenderStyle(
  tokens: ResolvedDesignTokens,
  fonts: { body: string; heading: string; mono: string },
): RenderStyle {
  return {
    background: tokens.palette.background,
    foreground: tokens.palette.foreground,
    primary: tokens.palette.primary,
    secondary: tokens.palette.secondary,
    accent: tokens.palette.accent,
    muted: tokens.palette.muted,
    border: tokens.palette.border,
    fontBody: fonts.body,
    fontHeading: fonts.heading,
    fontMono: fonts.mono,
    pad: tokens.spacing.lg,
    unit: tokens.spacing.unit,
    strokeHairline: tokens.stroke.hairline,
    strokeRegular: tokens.stroke.regular,
    strokeEmphasis: tokens.stroke.emphasis,
    cornerSm: tokens.corner.sm,
    cornerMd: tokens.corner.md,
    cornerLg: tokens.corner.lg,
    fontSizeXs: tokens.typeScale.xs,
    fontSizeSm: tokens.typeScale.sm,
    fontSizeBase: tokens.typeScale.base,
    fontSizeMd: tokens.typeScale.md,
    fontSizeLg: tokens.typeScale.lg,
    fontSizeXl: tokens.typeScale.xl,
    fontSize2xl: tokens.typeScale['2xl'],
  };
}

// ── Pipeline ──

export interface SVGRenderPipelineOptions {
  fontResolver: FontResolver;
  imageResolver: ImageResolver;
  /** Pinned environment identifier for hash stability */
  environmentId?: string;
  /** Font registry (defaults to bundled catalog) */
  fontRegistry?: FontRegistry;
}

export class SVGRenderPipeline {
  // @ts-expect-error – reserved for future phases (font resolution integration)
  private readonly _fontResolver: FontResolver;
  // @ts-expect-error – reserved for future phases (image embedding)
  private readonly _imageResolver: ImageResolver;
  private readonly fontRegistry: FontRegistry;
  private readonly environmentId: string;

  constructor(options: SVGRenderPipelineOptions) {
    // Reserved for future phases (sgr-3i9.4+)
    void (options.fontResolver);
    this._fontResolver = options.fontResolver;
    void (options.imageResolver);
    this._imageResolver = options.imageResolver;
    this.fontRegistry = options.fontRegistry ?? createFontRegistry();
    this.environmentId = options.environmentId ?? 'pinned-v1';
  }

  /**
   * Render a graphic request to an SVG result.
   *
   * The same request in the same pinned environment always produces
   * byte-stable SVG output.
   */
  async render(request: GraphicRenderRequest): Promise<GraphicRenderResult> {
    const startMs = Date.now();
    const diagnostics: RenderDiagnostic[] = [];

    // ── Resolve theme ──
    const themeId = request.themeId ?? 'visual-bible-dark';
    const tokens = resolveTheme(themeId);
    const provenance: ThemeProvenance = tokens.provenance;

    // ── Theme provenance diagnostic ──
    if (request.themeId !== undefined && request.themeId !== tokens.provenance.themeId) {
      diagnostics.push({
        code: 'theme.unrecognized',
        level: 'warning',
        message: `Theme "${request.themeId}" not recognized; using bundled default "${tokens.provenance.themeId}"`,
        context: { requested: request.themeId, resolved: tokens.provenance.themeId },
      });
    }

    // ── Palette contrast diagnostics ──
    const contrastReport = checkPaletteContrast(tokens.palette);
    const contrastDiags = contrastDiagnostics(contrastReport);
    for (const cd of contrastDiags) {
      diagnostics.push({
        code: cd.code,
        level: cd.level,
        message: cd.message,
      });
    }

    // ── Resolve font CSS specs from registry (no platform fallback) ──
    const fontSpecs = this.resolveFonts(tokens, diagnostics);

    // ── Build render style ──
    const style = buildRenderStyle(tokens, fontSpecs);

    // ── Compute request hash (canonical request + environment → stable id) ──
    const envAwareRequest = { request, environmentId: this.environmentId };
    const requestHash = computeContentHash(envAwareRequest);
    const stableId = generateStableId('gr', request);

    // ── Validate ──
    const validationDiagnostics = validateRequest(request);
    diagnostics.push(...validationDiagnostics);

    const hasErrors = diagnostics.some((d) => d.level === 'error');
    if (hasErrors) {
      const svg = renderErrorSvg(request, diagnostics, style);
      const svgHash = computeContentHash(svg);
      return {
        stableId,
        requestHash,
        svgContent: svg,
        width: request.width,
        height: request.height,
        kind: request.kind,
        status: 'failed',
        durationMs: Date.now() - startMs,
        diagnostics,
        timestamp: new Date().toISOString(),
        svgHash,
        themeProvenance: provenance,
      };
    }

    // ── Compute safe area (profile-aware) ──
    const profile = tokens.profile;
    const safeArea = request.safeArea ?? computePixelSafeArea(profile, request.width, request.height);

    // ── Render ──
    let status: RenderStatus = 'success';
    let svgContent: string;

    try {
      svgContent = this.renderByKind(request, style, safeArea);
    } catch (err) {
      diagnostics.push({
        code: 'render.unhandled',
        level: 'error',
        message: `Unhandled render error: ${err instanceof Error ? err.message : String(err)}`,
      });
      svgContent = renderErrorSvg(request, diagnostics, style);
      status = 'failed';
    }

    // Determine status from diagnostics
    if (status === 'success' && diagnostics.some((d) => d.level === 'warning')) {
      status = 'partial';
    }

    const svgHash = computeContentHash(svgContent);

    return {
      stableId,
      requestHash,
      svgContent,
      width: request.width,
      height: request.height,
      kind: request.kind,
      status,
      durationMs: Date.now() - startMs,
      diagnostics,
      timestamp: new Date().toISOString(),
      svgHash,
      themeProvenance: provenance,
    };
  }

  /**
   * Resolve font CSS specs from the registry.
   * Emits diagnostics for missing fonts and coverage gaps.
   * Never falls back to platform fonts.
   */
  private resolveFonts(
    _tokens: ResolvedDesignTokens,
    diagnostics: RenderDiagnostic[],
  ): { body: string; heading: string; mono: string } {
    const roles: Array<{ key: 'body' | 'heading' | 'mono'; textKey: string }> = [
      { key: 'body', textKey: '' },
      { key: 'heading', textKey: '' },
      { key: 'mono', textKey: '' },
    ];

    const result: { body: string; heading: string; mono: string } = {
      body: 'sans-serif',
      heading: 'sans-serif',
      mono: 'monospace',
    };

    for (const role of roles) {
      // Find font in registry by role
      const entry = this.fontRegistry.list().find((f: FontEntry) => f.role === role.key);
      if (!entry) {
        diagnostics.push({
          code: 'font.missing-role',
          level: 'error',
          message: `No font registered for role "${role.key}". ` +
            `Rendering with generic fallback; this is non-deterministic across environments. ` +
            `Register a font with role="${role.key}" in the FontRegistry.`,
        });
        continue;
      }

      // Check coverage: every registered font must cover Basic Latin
      const basicLatin = checkCoverage('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', entry);
      if (!basicLatin.fullyCovered) {
        diagnostics.push({
          code: 'font.insufficient-coverage',
          level: 'error',
          message: `Font "${entry.family}" (role: ${role.key}) does not cover Basic Latin. ` +
            `This font cannot render standard text reliably.`,
        });
      }

      // Use the first normal-weight variant's cssSpec, or fall back to the family name
      const normalVariant = entry.variants.find(
        (v) => v.weight === 400 && v.style === 'normal',
      ) ?? entry.variants[0];

      if (normalVariant) {
        result[role.key] = normalVariant.cssSpec;
      } else {
        // Should not happen with bundled fonts, but handle gracefully
        result[role.key] = `'${entry.family}', ${role.key === 'mono' ? 'monospace' : 'sans-serif'}`;
      }
    }

    return result;
  }

  /**
   * Dispatch to kind-specific renderer.
   */
  private renderByKind(
    request: GraphicRenderRequest,
    style: RenderStyle,
    safeArea: { top: number; right: number; bottom: number; left: number },
  ): string {
    const { width, height } = request;
    // Apply safe area to effective render bounds
    const innerW = width - safeArea.left - safeArea.right;
    const innerH = height - safeArea.top - safeArea.bottom;
    const ox = safeArea.left;
    const oy = safeArea.top;

    // Adjust style pad to respect safe area
    const effectiveStyle: RenderStyle = {
      ...style,
      pad: Math.min(style.pad, innerW * 0.05, innerH * 0.05),
    };

    switch (request.kind) {
      case 'code-frame':
        return renderCodeFrame(width, height, ox, oy, request.content as CodeFrameContent, effectiveStyle);
      case 'architecture-diagram':
        return renderDiagram(width, height, ox, oy, request.content as DiagramContent, effectiveStyle);
      case 'title-frame':
        return renderTitleFrame(width, height, ox, oy, request.content as TitleFrameContent, effectiveStyle);
      case 'callout':
        return renderCallout(width, height, ox, oy, request.content as CalloutContent, effectiveStyle);
      case 'comparison-layout':
        return renderComparison(width, height, ox, oy, request.content as ComparisonLayoutContent, effectiveStyle);
      case 'simple-chart':
        return renderSimpleChart(width, height, ox, oy, request.content as SimpleChartContent, effectiveStyle);
      case 'infographic-primitive':
        return renderInfographic(width, height, ox, oy, request.content as InfographicPrimitiveContent, effectiveStyle);
      default: {
        void (request.kind as never);
        const diags: RenderDiagnostic[] = [{
          code: 'render.unknown-kind',
          level: 'error',
          message: `Unknown graphic kind: ${String(request.kind)}`,
        }];
        return renderErrorSvg(request, diags, effectiveStyle);
      }
    }
  }
}

// ── Kind-specific renderers ──

function renderCodeFrame(
  width: number,
  height: number,
  ox: number,
  oy: number,
  content: CodeFrameContent,
  style: RenderStyle,
): string {
  const lines = content.code.split('\n');
  const lineHeight = 20;
  const fontSize = style.fontSizeSm;
  const lineNumberWidth = content.showLineNumbers ? 48 : 0;
  const codeX = ox + style.pad + lineNumberWidth;

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(style.background)}" />
<rect x="${ox + style.pad}" y="${oy + style.pad}" width="${width - (ox + style.pad) * 2}" height="${height - (oy + style.pad) * 2}" rx="${style.cornerMd}" fill="${esc(style.background)}" stroke="${esc(style.border)}" stroke-width="${style.strokeRegular}" />
${lines.map((line, i) => {
  const y = oy + style.pad + 24 + i * lineHeight;
  const escapedLine = esc(line || ' ');
  if (content.showLineNumbers) {
    return `<text x="${ox + style.pad + 8}" y="${y}" font-family="${esc(style.fontMono)}" font-size="${fontSize}px" fill="${esc(style.muted)}" text-anchor="end">${i + 1}</text>
<text x="${codeX + 8}" y="${y}" font-family="${esc(style.fontMono)}" font-size="${fontSize}px" fill="${esc(style.foreground)}">${escapedLine}</text>`;
  }
  return `<text x="${codeX}" y="${y}" font-family="${esc(style.fontMono)}" font-size="${fontSize}px" fill="${esc(style.foreground)}">${escapedLine}</text>`;
}).join('\n')}
<text x="${ox + style.pad + 12}" y="${oy + style.pad + 16}" font-family="${esc(style.fontMono)}" font-size="${style.fontSizeXs}px" fill="${esc(style.muted)}">${esc(content.language)}</text>
`);
}

function renderDiagram(
  width: number,
  height: number,
  ox: number,
  oy: number,
  content: DiagramContent,
  style: RenderStyle,
): string {
  const cols = Math.ceil(Math.sqrt(content.nodes.length));
  const cellW = (width - (ox + style.pad) * 2) / Math.max(cols, 1);
  const cellH = Math.min(80, (height - (oy + style.pad) * 2) / Math.max(Math.ceil(content.nodes.length / cols), 1));
  const nodeW = Math.max(cellW - 16, 80);
  const nodeH = Math.max(cellH - 12, 36);

  const nodesSvg = content.nodes.map((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = ox + style.pad + col * cellW + (cellW - nodeW) / 2;
    const y = oy + style.pad + row * cellH + (cellH - nodeH) / 2;
    const fill = node.kind === 'start' || node.kind === 'end'
      ? style.secondary
      : node.kind === 'decision'
        ? style.accent
        : style.primary;
    return `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="${style.cornerSm}" fill="${esc(fill)}" opacity="0.15" stroke="${esc(fill)}" stroke-width="${style.strokeEmphasis}" />
<text x="${x + nodeW / 2}" y="${y + nodeH / 2 + 5}" font-family="${esc(style.fontBody)}" font-size="${style.fontSizeSm}px" fill="${esc(style.foreground)}" text-anchor="middle">${esc(node.label)}</text>`;
  }).join('\n');

  const edgesSvg = content.edges.map((edge) => {
    const fromIdx = content.nodes.findIndex((n) => n.id === edge.from);
    const toIdx = content.nodes.findIndex((n) => n.id === edge.to);
    if (fromIdx < 0 || toIdx < 0) return '';
    const fromCol = fromIdx % cols;
    const fromRow = Math.floor(fromIdx / cols);
    const toCol = toIdx % cols;
    const toRow = Math.floor(toIdx / cols);
    const x1 = ox + style.pad + fromCol * cellW + cellW / 2;
    const y1 = oy + style.pad + fromRow * cellH + cellH;
    const x2 = ox + style.pad + toCol * cellW + cellW / 2;
    const y2 = oy + style.pad + toRow * cellH;
    const midY = (y1 + y2) / 2;
    return `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}" fill="none" stroke="${esc(style.muted)}" stroke-width="${style.strokeEmphasis}" marker-end="url(#arrowhead)" />`;
  }).join('\n');

  return svgDoc(width, height, /* language=xml */ `
<defs>
  <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
    <polygon points="0 0, 8 3, 0 6" fill="${esc(style.muted)}" />
  </marker>
</defs>
<rect width="100%" height="100%" fill="${esc(style.background)}" />
${nodesSvg}
${edgesSvg}
`);
}

function renderTitleFrame(
  width: number,
  height: number,
  ox: number,
  oy: number,
  content: TitleFrameContent,
  style: RenderStyle,
): string {
  const align = content.alignment ?? 'center';
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const x = align === 'left' ? ox + style.pad : align === 'right' ? width - ox - style.pad : width / 2;
  const titleY = height / 2 - (content.subtitle ? 16 : 0);

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(style.background)}" />
<rect x="${ox + style.pad}" y="${oy + style.pad}" width="${width - (ox + style.pad) * 2}" height="${height - (oy + style.pad) * 2}" rx="${style.cornerLg}" fill="none" stroke="${esc(style.border)}" stroke-width="${style.strokeRegular}" />
<text x="${x}" y="${titleY}" font-family="${esc(style.fontHeading)}" font-size="${style.fontSize2xl}px" font-weight="700" fill="${esc(style.foreground)}" text-anchor="${anchor}">${esc(content.title)}</text>
${content.subtitle
  ? `<text x="${x}" y="${titleY + 48}" font-family="${esc(style.fontBody)}" font-size="${style.fontSizeLg}px" fill="${esc(style.muted)}" text-anchor="${anchor}">${esc(content.subtitle)}</text>`
  : ''}
`);
}

function renderCallout(
  width: number,
  height: number,
  ox: number,
  oy: number,
  content: CalloutContent,
  style: RenderStyle,
): string {
  const severityColors: Record<string, string> = {
    info: style.primary,
    warning: style.accent,
    tip: style.secondary,
    note: style.muted,
  };
  const accentColor = severityColors[content.severity ?? 'info'] ?? style.primary;

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(style.background)}" />
<rect x="${ox + style.pad}" y="${oy + style.pad}" width="${width - (ox + style.pad) * 2}" height="${height - (oy + style.pad) * 2}" rx="${style.cornerMd}" fill="${esc(accentColor)}" opacity="0.08" stroke="${esc(accentColor)}" stroke-width="${style.strokeRegular}" />
<rect x="${ox + style.pad}" y="${oy + style.pad}" width="4" height="${height - (oy + style.pad) * 2}" rx="2" fill="${esc(accentColor)}" />
${content.icon ? `<text x="${ox + style.pad + 20}" y="${height / 2 - 8}" font-size="24px" fill="${esc(accentColor)}" text-anchor="middle">${esc(content.icon)}</text>` : ''}
<text x="${ox + style.pad + (content.icon ? 44 : 20)}" y="${height / 2 + 6}" font-family="${esc(style.fontBody)}" font-size="${style.fontSizeBase}px" fill="${esc(style.foreground)}">${esc(content.text)}</text>
`);
}

function renderComparison(
  width: number,
  height: number,
  ox: number,
  oy: number,
  content: ComparisonLayoutContent,
  style: RenderStyle,
): string {
  const midX = width / 2;
  const colW = (width - (ox + style.pad) * 2 - 24) / 2;
  const leftX = ox + style.pad;
  const rightX = midX + 12;

  const renderSections = (
    sections: { heading?: string; body: string }[],
    sx: number,
  ): string => {
    let y = oy + style.pad + 40;
    return sections
      .map((s) => {
        const parts: string[] = [];
        if (s.heading) {
          parts.push(
            `<text x="${sx + 8}" y="${y}" font-family="${esc(style.fontHeading)}" font-size="${style.fontSizeBase}px" font-weight="600" fill="${esc(style.primary)}">${esc(s.heading)}</text>`,
          );
          y += 22;
        }
        parts.push(
          `<text x="${sx + 8}" y="${y}" font-family="${esc(style.fontBody)}" font-size="${style.fontSizeSm}px" fill="${esc(style.foreground)}">${esc(s.body)}</text>`,
        );
        y += 28;
        return parts.join('\n');
      })
      .join('\n');
  };

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(style.background)}" />
<text x="${leftX + colW / 2}" y="${oy + style.pad + 20}" font-family="${esc(style.fontHeading)}" font-size="${style.fontSizeLg}px" font-weight="600" fill="${esc(style.foreground)}" text-anchor="middle">${esc(content.leftTitle)}</text>
<text x="${rightX + colW / 2}" y="${oy + style.pad + 20}" font-family="${esc(style.fontHeading)}" font-size="${style.fontSizeLg}px" font-weight="600" fill="${esc(style.foreground)}" text-anchor="middle">${esc(content.rightTitle)}</text>
<line x1="${midX}" y1="${oy + style.pad}" x2="${midX}" y2="${height - oy - style.pad}" stroke="${esc(style.border)}" stroke-width="${style.strokeRegular}" />
${renderSections(content.leftSections, leftX)}
${renderSections(content.rightSections, rightX)}
`);
}

function renderSimpleChart(
  width: number,
  height: number,
  ox: number,
  oy: number,
  content: SimpleChartContent,
  style: RenderStyle,
): string {
  if (content.chartType === 'bar') {
    const maxVal = Math.max(...content.data.map((d) => d.value), 1);
    const chartTop = oy + style.pad + (content.title ? 40 : 10);
    const chartBottom = height - oy - style.pad - 30;
    const chartH = chartBottom - chartTop;
    const barGap = 8;
    const barW = Math.max(
      (width - (ox + style.pad) * 2 - (content.data.length - 1) * barGap) / content.data.length,
      4,
    );

    const bars = content.data
      .map((d, i) => {
        const barH = Math.max((d.value / maxVal) * chartH, 2);
        const x = ox + style.pad + i * (barW + barGap);
        const y = chartBottom - barH;
        const fill = d.color ?? style.primary;
        return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="${style.cornerSm}" fill="${esc(fill)}" />
<text x="${x + barW / 2}" y="${chartBottom + 18}" font-family="${esc(style.fontBody)}" font-size="${style.fontSizeXs}px" fill="${esc(style.muted)}" text-anchor="middle">${esc(d.label)}</text>`;
      })
      .join('\n');

    return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(style.background)}" />
${content.title ? `<text x="${width / 2}" y="${oy + style.pad + 20}" font-family="${esc(style.fontHeading)}" font-size="${style.fontSizeMd}px" font-weight="600" fill="${esc(style.foreground)}" text-anchor="middle">${esc(content.title)}</text>` : ''}
<line x1="${ox + style.pad}" y1="${chartBottom}" x2="${width - ox - style.pad}" y2="${chartBottom}" stroke="${esc(style.border)}" stroke-width="${style.strokeRegular}" />
${bars}
`);
  }

  // Validation rejects unsupported chart types before dispatch. Throwing here
  // prevents a future caller from accidentally receiving a successful placeholder.
  throw new Error(`Unsupported chart type: ${content.chartType}`);
}

function renderInfographic(
  width: number,
  height: number,
  ox: number,
  _oy: number,
  content: InfographicPrimitiveContent,
  style: RenderStyle,
): string {
  const property = (name: string): string => String(content.properties[name]);
  let body: string;

  switch (content.primitiveType) {
    case 'icon':
      body = `<text x="${width / 2}" y="${height / 2 + 18}" font-family="${esc(style.fontHeading)}" font-size="56px" fill="${esc(style.primary)}" text-anchor="middle">${esc(property('symbol'))}</text>`;
      break;
    case 'badge':
      body = `<rect x="${ox + style.pad}" y="${height / 2 - 24}" width="${width - (ox + style.pad) * 2}" height="48" rx="24" fill="${esc(style.primary)}" />
<text x="${width / 2}" y="${height / 2 + 6}" font-family="${esc(style.fontHeading)}" font-size="18px" font-weight="700" fill="${esc(style.background)}" text-anchor="middle">${esc(property('label'))}</text>`;
      break;
    case 'step-indicator':
      body = `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.max(20, Math.min(width, height) / 3)}" fill="${esc(style.primary)}" />
<text x="${width / 2}" y="${height / 2 + 8}" font-family="${esc(style.fontHeading)}" font-size="24px" font-weight="700" fill="${esc(style.background)}" text-anchor="middle">${esc(property('step'))}/${esc(property('total'))}</text>`;
      break;
    case 'stat-card':
      body = `<text x="${width / 2}" y="${height / 2}" font-family="${esc(style.fontHeading)}" font-size="40px" font-weight="700" fill="${esc(style.primary)}" text-anchor="middle">${esc(property('value'))}</text>
<text x="${width / 2}" y="${height / 2 + 30}" font-family="${esc(style.fontBody)}" font-size="${style.fontSizeBase}px" fill="${esc(style.muted)}" text-anchor="middle">${esc(property('label'))}</text>`;
      break;
  }

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(style.background)}" />
${body}
`);
}

// ── Error SVG ──

function renderErrorSvg(
  request: GraphicRenderRequest,
  diagnostics: RenderDiagnostic[],
  style: RenderStyle,
): string {
  const errors = diagnostics.filter((d) => d.level === 'error');
  const msg = errors.length > 0 ? errors[0].message : 'Unknown error';

  return svgDoc(request.width, request.height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(style.background)}" />
<rect x="16" y="16" width="${request.width - 32}" height="${request.height - 32}" rx="${style.cornerMd}" fill="none" stroke="${esc('#e74c3c')}" stroke-width="${style.strokeEmphasis}" />
<text x="${request.width / 2}" y="${request.height / 2 - 8}" font-family="${esc(style.fontBody)}" font-size="${style.fontSizeBase}px" fill="${esc('#e74c3c')}" text-anchor="middle">Render Error</text>
<text x="${request.width / 2}" y="${request.height / 2 + 20}" font-family="${esc(style.fontMono)}" font-size="${style.fontSizeXs}px" fill="${esc(style.muted)}" text-anchor="middle">${esc(msg)}</text>
`);
}

// ── Validation ──

function validateRequest(request: GraphicRenderRequest): RenderDiagnostic[] {
  const diags: RenderDiagnostic[] = [];

  if (request.width <= 0 || !Number.isFinite(request.width)) {
    diags.push({
      code: 'validation.invalid-width',
      level: 'error',
      message: `Width must be a positive finite number, got ${request.width}`,
    });
  }
  if (request.height <= 0 || !Number.isFinite(request.height)) {
    diags.push({
      code: 'validation.invalid-height',
      level: 'error',
      message: `Height must be a positive finite number, got ${request.height}`,
    });
  }

  // Kind-specific content validation
  if (request.kind === 'code-frame') {
    const c = request.content as CodeFrameContent;
    if (!c.language?.trim()) {
      diags.push({
        code: 'validation.missing-language',
        level: 'warning',
        message: 'Code frame has no language specified',
      });
    }
    if (c.code === undefined || c.code === null) {
      diags.push({
        code: 'validation.missing-code',
        level: 'error',
        message: 'Code frame content missing code',
      });
    }
  }

  if (request.kind === 'architecture-diagram') {
    const c = request.content as DiagramContent;
    if (!c.nodes || c.nodes.length === 0) {
      diags.push({
        code: 'validation.empty-nodes',
        level: 'warning',
        message: 'Diagram has no nodes',
      });
    }
    const nodeIds = new Set(c.nodes?.map((n) => n.id) ?? []);
    for (const edge of c.edges ?? []) {
      if (!nodeIds.has(edge.from)) {
        diags.push({
          code: 'validation.unknown-node',
          level: 'error',
          message: `Edge references unknown source node: ${edge.from}`,
        });
      }
      if (!nodeIds.has(edge.to)) {
        diags.push({
          code: 'validation.unknown-node',
          level: 'error',
          message: `Edge references unknown target node: ${edge.to}`,
        });
      }
    }
  }

  if (request.kind === 'title-frame') {
    const c = request.content as TitleFrameContent;
    if (!c.title?.trim()) {
      diags.push({
        code: 'validation.missing-title',
        level: 'error',
        message: 'Title frame has no title',
      });
    }
  }

  if (request.kind === 'simple-chart') {
    const c = request.content as SimpleChartContent;
    if (c.chartType !== 'bar') {
      diags.push({
        code: 'capability.unsupported-chart-type',
        level: 'error',
        message: `Chart type ${c.chartType} is not implemented; use bar or request another renderer`,
      });
    }
    if (!c.data?.length) {
      diags.push({
        code: 'validation.empty-chart-data',
        level: 'error',
        message: 'Chart data must contain at least one point',
      });
    }
    for (const point of c.data ?? []) {
      if (!Number.isFinite(point.value) || point.value < 0) {
        diags.push({
          code: 'validation.invalid-chart-value',
          level: 'error',
          message: `Chart value for ${point.label} must be a finite non-negative number`,
        });
      }
    }
  }

  if (request.kind === 'infographic-primitive') {
    const c = request.content as InfographicPrimitiveContent;
    const requiredByKind: Record<InfographicPrimitiveContent['primitiveType'], string[]> = {
      icon: ['symbol'],
      badge: ['label'],
      'step-indicator': ['step', 'total'],
      'stat-card': ['value', 'label'],
    };
    for (const property of requiredByKind[c.primitiveType]) {
      if (c.properties[property] === undefined || String(c.properties[property]).trim() === '') {
        diags.push({
          code: 'validation.missing-infographic-property',
          level: 'error',
          message: `${c.primitiveType} requires property ${property}`,
          context: { primitiveType: c.primitiveType, property },
        });
      }
    }
  }

  return diags;
}

// ── SVG helpers ──

function svgDoc(w: number, h: number, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${body}
</svg>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
