// ── SVG-first render pipeline ──
// Deterministic renderer that accepts GraphicRenderRequest
// and produces byte-stable SVG output.

import type { FontResolver } from '../resolver/font-resolver.js';
import type { ImageResolver } from '../resolver/image-resolver.js';
import type {
  GraphicRenderRequest,
  GraphicTheme,
  CodeFrameContent,
  DiagramContent,
  TitleFrameContent,
  CalloutContent,
  ComparisonLayoutContent,
  SimpleChartContent,
  InfographicPrimitiveContent,
} from '../models/request.js';
import type { GraphicRenderResult, RenderDiagnostic, RenderStatus } from '../models/result.js';
import { computeContentHash, generateStableId } from '../hashing/content-hash.js';

// ── Default theme (pinned, deterministic) ──

const DEFAULT_THEME: GraphicTheme = {
  id: 'default-dark',
  colors: {
    background: '#1a1a2e',
    foreground: '#e0e0e0',
    primary: '#7b68ee',
    secondary: '#48c9b0',
    accent: '#f39c12',
    muted: '#6c6c80',
    border: '#2d2d44',
  },
  fonts: {
    body: 'system-ui, -apple-system, sans-serif',
    heading: 'system-ui, -apple-system, sans-serif',
    mono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  },
  spacing: {
    unit: 8,
    pad: 24,
  },
};

// ── Pipeline ──

export interface SVGRenderPipelineOptions {
  fontResolver: FontResolver;
  imageResolver: ImageResolver;
  /** Pinned environment identifier for hash stability */
  environmentId?: string;
}

export class SVGRenderPipeline {
  // Resolvers stored for future phases (sgr-3i9.2+).
  // @ts-expect-error – reserved for series theme and font resolution
  private readonly _fontResolver: FontResolver;
  // @ts-expect-error – reserved for image embedding
  private readonly _imageResolver: ImageResolver;
  private readonly environmentId: string;

  constructor(options: SVGRenderPipelineOptions) {
    this._fontResolver = options.fontResolver;
    this._imageResolver = options.imageResolver;
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

    // ── Compute request hash (canonical request + environment → stable id) ──
    const envAwareRequest = { request, environmentId: this.environmentId };
    const requestHash = computeContentHash(envAwareRequest);
    const stableId = generateStableId('gr', request);

    // ── Validate ──
    const validationDiagnostics = validateRequest(request);
    diagnostics.push(...validationDiagnostics);

    const hasErrors = diagnostics.some((d) => d.level === 'error');
    if (hasErrors) {
      const svg = renderErrorSvg(request, diagnostics);
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
      };
    }

    // ── Render ──
    let status: RenderStatus = 'success';
    let svgContent: string;

    try {
      svgContent = this.renderByKind(request, diagnostics);
    } catch (err) {
      diagnostics.push({
        code: 'render.unhandled',
        level: 'error',
        message: `Unhandled render error: ${err instanceof Error ? err.message : String(err)}`,
      });
      svgContent = renderErrorSvg(request, diagnostics);
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
    };
  }

  /**
   * Dispatch to kind-specific renderer.
   */
  private renderByKind(
    request: GraphicRenderRequest,
    diagnostics: RenderDiagnostic[],
  ): string {
    const theme = DEFAULT_THEME;
    const { width, height } = request;

    switch (request.kind) {
      case 'code-frame':
        return renderCodeFrame(width, height, request.content as CodeFrameContent, theme);
      case 'architecture-diagram':
        return renderDiagram(width, height, request.content as DiagramContent, theme);
      case 'title-frame':
        return renderTitleFrame(width, height, request.content as TitleFrameContent, theme);
      case 'callout':
        return renderCallout(width, height, request.content as CalloutContent, theme);
      case 'comparison-layout':
        return renderComparison(width, height, request.content as ComparisonLayoutContent, theme);
      case 'simple-chart':
        return renderSimpleChart(width, height, request.content as SimpleChartContent, theme);
      case 'infographic-primitive':
        return renderInfographic(width, height, request.content as InfographicPrimitiveContent, theme);
      default: {
        void (request.kind as never);
        diagnostics.push({
          code: 'render.unknown-kind',
          level: 'error',
          message: `Unknown graphic kind: ${String(request.kind)}`,
        });
        return renderErrorSvg(request, diagnostics);
      }
    }
  }
}

// ── Kind-specific renderers ──

function renderCodeFrame(
  width: number,
  height: number,
  content: CodeFrameContent,
  theme: GraphicTheme,
): string {
  const { colors, fonts, spacing } = theme;
  const lines = content.code.split('\n');
  const lineHeight = 20;
  const fontSize = 13;
  const lineNumberWidth = content.showLineNumbers ? 48 : 0;
  const codeX = spacing.pad + lineNumberWidth;

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(colors.background)}" />
<rect x="${spacing.pad}" y="${spacing.pad}" width="${width - spacing.pad * 2}" height="${height - spacing.pad * 2}" rx="6" fill="${esc(colors.background)}" stroke="${esc(colors.border)}" stroke-width="1" />
${lines.map((line, i) => {
  const y = spacing.pad + 24 + i * lineHeight;
  const escapedLine = esc(line || ' ');
  if (content.showLineNumbers) {
    return `<text x="${spacing.pad + 8}" y="${y}" font-family="${esc(fonts.mono)}" font-size="${fontSize}px" fill="${esc(colors.muted)}" text-anchor="end">${i + 1}</text>
<text x="${codeX + 8}" y="${y}" font-family="${esc(fonts.mono)}" font-size="${fontSize}px" fill="${esc(colors.foreground)}">${escapedLine}</text>`;
  }
  return `<text x="${codeX}" y="${y}" font-family="${esc(fonts.mono)}" font-size="${fontSize}px" fill="${esc(colors.foreground)}">${escapedLine}</text>`;
}).join('\n')}
<text x="${spacing.pad + 12}" y="${spacing.pad + 16}" font-family="${esc(fonts.mono)}" font-size="10px" fill="${esc(colors.muted)}">${esc(content.language)}</text>
`);
}

function renderDiagram(
  width: number,
  height: number,
  content: DiagramContent,
  theme: GraphicTheme,
): string {
  const { colors, fonts, spacing } = theme;
  // Compute simple grid layout
  const cols = Math.ceil(Math.sqrt(content.nodes.length));
  const cellW = (width - spacing.pad * 2) / Math.max(cols, 1);
  const cellH = Math.min(80, (height - spacing.pad * 2) / Math.max(Math.ceil(content.nodes.length / cols), 1));
  const nodeW = Math.max(cellW - 16, 80);
  const nodeH = Math.max(cellH - 12, 36);

  const nodesSvg = content.nodes.map((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = spacing.pad + col * cellW + (cellW - nodeW) / 2;
    const y = spacing.pad + row * cellH + (cellH - nodeH) / 2;
    const fill = node.kind === 'start' || node.kind === 'end'
      ? colors.secondary
      : node.kind === 'decision'
        ? colors.accent
        : colors.primary;
    return `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="4" fill="${esc(fill)}" opacity="0.15" stroke="${esc(fill)}" stroke-width="1.5" />
<text x="${x + nodeW / 2}" y="${y + nodeH / 2 + 5}" font-family="${esc(fonts.body)}" font-size="13px" fill="${esc(colors.foreground)}" text-anchor="middle">${esc(node.label)}</text>`;
  }).join('\n');

  // Draw edges as simple arrows (approximate)
  const edgesSvg = content.edges.map((edge) => {
    const fromIdx = content.nodes.findIndex((n) => n.id === edge.from);
    const toIdx = content.nodes.findIndex((n) => n.id === edge.to);
    if (fromIdx < 0 || toIdx < 0) return '';
    const fromCol = fromIdx % cols;
    const fromRow = Math.floor(fromIdx / cols);
    const toCol = toIdx % cols;
    const toRow = Math.floor(toIdx / cols);
    const x1 = spacing.pad + fromCol * cellW + cellW / 2;
    const y1 = spacing.pad + fromRow * cellH + cellH;
    const x2 = spacing.pad + toCol * cellW + cellW / 2;
    const y2 = spacing.pad + toRow * cellH;
    const midY = (y1 + y2) / 2;
    return `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}" fill="none" stroke="${esc(colors.muted)}" stroke-width="1.5" marker-end="url(#arrowhead)" />`;
  }).join('\n');

  return svgDoc(width, height, /* language=xml */ `
<defs>
  <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
    <polygon points="0 0, 8 3, 0 6" fill="${esc(colors.muted)}" />
  </marker>
</defs>
<rect width="100%" height="100%" fill="${esc(colors.background)}" />
${nodesSvg}
${edgesSvg}
`);
}

function renderTitleFrame(
  width: number,
  height: number,
  content: TitleFrameContent,
  theme: GraphicTheme,
): string {
  const { colors, fonts, spacing } = theme;
  const align = content.alignment ?? 'center';
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const x = align === 'left' ? spacing.pad : align === 'right' ? width - spacing.pad : width / 2;
  const titleY = height / 2 - (content.subtitle ? 16 : 0);

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(colors.background)}" />
<rect x="${spacing.pad}" y="${spacing.pad}" width="${width - spacing.pad * 2}" height="${height - spacing.pad * 2}" rx="8" fill="none" stroke="${esc(colors.border)}" stroke-width="1" />
<text x="${x}" y="${titleY}" font-family="${esc(fonts.heading)}" font-size="36px" font-weight="700" fill="${esc(colors.foreground)}" text-anchor="${anchor}">${esc(content.title)}</text>
${content.subtitle
  ? `<text x="${x}" y="${titleY + 48}" font-family="${esc(fonts.body)}" font-size="18px" fill="${esc(colors.muted)}" text-anchor="${anchor}">${esc(content.subtitle)}</text>`
  : ''}
`);
}

function renderCallout(
  width: number,
  height: number,
  content: CalloutContent,
  theme: GraphicTheme,
): string {
  const { colors, fonts, spacing } = theme;
  const severityColors: Record<string, string> = {
    info: colors.primary,
    warning: colors.accent,
    tip: colors.secondary,
    note: colors.muted,
  };
  const accentColor = severityColors[content.severity ?? 'info'] ?? colors.primary;

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(colors.background)}" />
<rect x="${spacing.pad}" y="${spacing.pad}" width="${width - spacing.pad * 2}" height="${height - spacing.pad * 2}" rx="6" fill="${esc(accentColor)}" opacity="0.08" stroke="${esc(accentColor)}" stroke-width="1" />
<rect x="${spacing.pad}" y="${spacing.pad}" width="4" height="${height - spacing.pad * 2}" rx="2" fill="${esc(accentColor)}" />
${content.icon ? `<text x="${spacing.pad + 20}" y="${height / 2 - 8}" font-size="24px" fill="${esc(accentColor)}" text-anchor="middle">${esc(content.icon)}</text>` : ''}
<text x="${spacing.pad + (content.icon ? 44 : 20)}" y="${height / 2 + 6}" font-family="${esc(fonts.body)}" font-size="15px" fill="${esc(colors.foreground)}">${esc(content.text)}</text>
`);
}

function renderComparison(
  width: number,
  height: number,
  content: ComparisonLayoutContent,
  theme: GraphicTheme,
): string {
  const { colors, fonts, spacing } = theme;
  const midX = width / 2;
  const colW = (width - spacing.pad * 2 - 24) / 2;
  const leftX = spacing.pad;
  const rightX = midX + 12;

  const renderSections = (
    sections: { heading?: string; body: string }[],
    ox: number,
  ): string => {
    let y = spacing.pad + 40;
    return sections
      .map((s) => {
        const parts: string[] = [];
        if (s.heading) {
          parts.push(
            `<text x="${ox + 8}" y="${y}" font-family="${esc(fonts.heading)}" font-size="14px" font-weight="600" fill="${esc(colors.primary)}">${esc(s.heading)}</text>`,
          );
          y += 22;
        }
        parts.push(
          `<text x="${ox + 8}" y="${y}" font-family="${esc(fonts.body)}" font-size="13px" fill="${esc(colors.foreground)}">${esc(s.body)}</text>`,
        );
        y += 28;
        return parts.join('\n');
      })
      .join('\n');
  };

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(colors.background)}" />
<text x="${leftX + colW / 2}" y="${spacing.pad + 20}" font-family="${esc(fonts.heading)}" font-size="18px" font-weight="600" fill="${esc(colors.foreground)}" text-anchor="middle">${esc(content.leftTitle)}</text>
<text x="${rightX + colW / 2}" y="${spacing.pad + 20}" font-family="${esc(fonts.heading)}" font-size="18px" font-weight="600" fill="${esc(colors.foreground)}" text-anchor="middle">${esc(content.rightTitle)}</text>
<line x1="${midX}" y1="${spacing.pad}" x2="${midX}" y2="${height - spacing.pad}" stroke="${esc(colors.border)}" stroke-width="1" />
${renderSections(content.leftSections, leftX)}
${renderSections(content.rightSections, rightX)}
`);
}

function renderSimpleChart(
  width: number,
  height: number,
  content: SimpleChartContent,
  theme: GraphicTheme,
): string {
  const { colors, fonts, spacing } = theme;

  if (content.chartType === 'bar') {
    const maxVal = Math.max(...content.data.map((d) => d.value), 1);
    const chartTop = spacing.pad + (content.title ? 40 : 10);
    const chartBottom = height - spacing.pad - 30;
    const chartH = chartBottom - chartTop;
    const barGap = 8;
    const barW = Math.max(
      (width - spacing.pad * 2 - (content.data.length - 1) * barGap) / content.data.length,
      4,
    );

    const bars = content.data
      .map((d, i) => {
        const barH = Math.max((d.value / maxVal) * chartH, 2);
        const x = spacing.pad + i * (barW + barGap);
        const y = chartBottom - barH;
        const fill = d.color ?? colors.primary;
        return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${esc(fill)}" />
<text x="${x + barW / 2}" y="${chartBottom + 18}" font-family="${esc(fonts.body)}" font-size="11px" fill="${esc(colors.muted)}" text-anchor="middle">${esc(d.label)}</text>`;
      })
      .join('\n');

    return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(colors.background)}" />
${content.title ? `<text x="${width / 2}" y="${spacing.pad + 20}" font-family="${esc(fonts.heading)}" font-size="16px" font-weight="600" fill="${esc(colors.foreground)}" text-anchor="middle">${esc(content.title)}</text>` : ''}
<line x1="${spacing.pad}" y1="${chartBottom}" x2="${width - spacing.pad}" y2="${chartBottom}" stroke="${esc(colors.border)}" stroke-width="1" />
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
  content: InfographicPrimitiveContent,
  theme: GraphicTheme,
): string {
  const { colors, fonts, spacing } = theme;
  const property = (name: string): string => String(content.properties[name]);
  let body: string;

  switch (content.primitiveType) {
    case 'icon':
      body = `<text x="${width / 2}" y="${height / 2 + 18}" font-family="${esc(fonts.heading)}" font-size="56px" fill="${esc(colors.primary)}" text-anchor="middle">${esc(property('symbol'))}</text>`;
      break;
    case 'badge':
      body = `<rect x="${spacing.pad}" y="${height / 2 - 24}" width="${width - spacing.pad * 2}" height="48" rx="24" fill="${esc(colors.primary)}" />
<text x="${width / 2}" y="${height / 2 + 6}" font-family="${esc(fonts.heading)}" font-size="18px" font-weight="700" fill="${esc(colors.background)}" text-anchor="middle">${esc(property('label'))}</text>`;
      break;
    case 'step-indicator':
      body = `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.max(20, Math.min(width, height) / 3)}" fill="${esc(colors.primary)}" />
<text x="${width / 2}" y="${height / 2 + 8}" font-family="${esc(fonts.heading)}" font-size="24px" font-weight="700" fill="${esc(colors.background)}" text-anchor="middle">${esc(property('step'))}/${esc(property('total'))}</text>`;
      break;
    case 'stat-card':
      body = `<text x="${width / 2}" y="${height / 2}" font-family="${esc(fonts.heading)}" font-size="40px" font-weight="700" fill="${esc(colors.primary)}" text-anchor="middle">${esc(property('value'))}</text>
<text x="${width / 2}" y="${height / 2 + 30}" font-family="${esc(fonts.body)}" font-size="14px" fill="${esc(colors.muted)}" text-anchor="middle">${esc(property('label'))}</text>`;
      break;
  }

  return svgDoc(width, height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(colors.background)}" />
${body}
`);
}

// ── Error SVG ──

function renderErrorSvg(
  request: GraphicRenderRequest,
  diagnostics: RenderDiagnostic[],
): string {
  const theme = DEFAULT_THEME;
  const { colors, fonts } = theme;
  const errors = diagnostics.filter((d) => d.level === 'error');
  const msg = errors.length > 0 ? errors[0].message : 'Unknown error';

  return svgDoc(request.width, request.height, /* language=xml */ `
<rect width="100%" height="100%" fill="${esc(colors.background)}" />
<rect x="16" y="16" width="${request.width - 32}" height="${request.height - 32}" rx="6" fill="none" stroke="${esc('#e74c3c')}" stroke-width="2" />
<text x="${request.width / 2}" y="${request.height / 2 - 8}" font-family="${esc(fonts.body)}" font-size="14px" fill="${esc('#e74c3c')}" text-anchor="middle">Render Error</text>
<text x="${request.width / 2}" y="${request.height / 2 + 20}" font-family="${esc(fonts.mono)}" font-size="11px" fill="${esc(colors.muted)}" text-anchor="middle">${esc(msg)}</text>
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
    // Validate edge references
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
