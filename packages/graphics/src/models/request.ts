// ── Graphic kind vocabulary ──
// Closed vocabulary: consumers must not invent values.
// Derived from the contract catalog `graphics.render` capability.

export type GraphicKind =
  | 'code-frame'
  | 'architecture-diagram'
  | 'title-frame'
  | 'callout'
  | 'comparison-layout'
  | 'simple-chart'
  | 'infographic-primitive';

// ── Safe area (in device-independent pixels from edge) ──

export interface SafeArea {
  /** Pixels from top edge */
  top: number;
  /** Pixels from right edge */
  right: number;
  /** Pixels from bottom edge */
  bottom: number;
  /** Pixels from left edge */
  left: number;
}

// ── Content payloads (discriminated by kind) ──

export interface CodeFrameContent {
  language: string;
  code: string;
  highlightLines?: number[];
  showLineNumbers?: boolean;
  maxLines?: number;
}

export interface DiagramContent {
  diagramType: 'flowchart' | 'architecture' | 'sequence';
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  layout?: 'top-to-bottom' | 'left-to-right';
}

export interface DiagramNode {
  id: string;
  label: string;
  kind: 'process' | 'decision' | 'data' | 'start' | 'end';
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface TitleFrameContent {
  title: string;
  subtitle?: string;
  alignment?: 'left' | 'center' | 'right';
}

export interface CalloutContent {
  text: string;
  icon?: string;
  severity?: 'info' | 'warning' | 'tip' | 'note';
}

export interface ComparisonLayoutContent {
  leftTitle: string;
  rightTitle: string;
  leftSections: TextSection[];
  rightSections: TextSection[];
}

export interface TextSection {
  heading?: string;
  body: string;
}

export interface SimpleChartContent {
  chartType: 'bar' | 'line' | 'pie';
  title?: string;
  data: ChartDataPoint[];
}

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface InfographicPrimitiveContent {
  primitiveType: 'icon' | 'badge' | 'step-indicator' | 'stat-card';
  properties: Record<string, string | number | boolean>;
}

// ── Unified request ──

export type GraphicContent =
  | CodeFrameContent
  | DiagramContent
  | TitleFrameContent
  | CalloutContent
  | ComparisonLayoutContent
  | SimpleChartContent
  | InfographicPrimitiveContent;

export interface GraphicRenderRequest {
  /** Stable content kind discriminator */
  kind: GraphicKind;
  /** Output width in device-independent pixels */
  width: number;
  /** Output height in device-independent pixels */
  height: number;
  /** Content payload (shape depends on kind) */
  content: GraphicContent;
  /** Theme identifier resolved by the series theme system */
  themeId?: string;
  /** Optional safe area override */
  safeArea?: SafeArea;
  /** Caller-supplied metadata (not used for rendering) */
  metadata?: Readonly<Record<string, string>>;
  /**
   * Opaque idempotency key. When provided, the renderer may
   * return a cached result for the same key and request shape.
   */
  idempotencyKey?: string;
}

// ── Theme placeholder ──

export interface GraphicTheme {
  id: string;
  colors: GraphicThemeColors;
  fonts: GraphicThemeFonts;
  spacing: GraphicThemeSpacing;
}

export interface GraphicThemeColors {
  background: string;
  foreground: string;
  primary: string;
  secondary: string;
  accent: string;
  muted: string;
  border: string;
}

export interface GraphicThemeFonts {
  body: string;
  heading: string;
  mono: string;
}

export interface GraphicThemeSpacing {
  /** Base spacing unit in pixels */
  unit: number;
  /** Padding inside the graphic frame */
  pad: number;
}
