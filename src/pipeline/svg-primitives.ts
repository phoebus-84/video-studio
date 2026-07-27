// ---------------------------------------------------------------------------
// Safe SVG layout primitives
// ---------------------------------------------------------------------------
// Deterministic SVG primitives for building graphics.
// Every function produces byte-stable output with no platform dependencies.
// ---------------------------------------------------------------------------

// ── Types ───────────────────────────────────────────────────────────────────

export interface SvgElement {
  tag: string;
  attrs: Record<string, string>;
  children?: (SvgElement | string)[];
  text?: string;
}

export interface SvgDocument {
  width: number;
  height: number;
  elements: SvgElement[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fill?: string;
  textAnchor?: "start" | "middle" | "end";
  dominantBaseline?: string;
}

export interface LayoutOptions {
  /** Padding inside the container (px). */
  padding?: number;
  /** Gap between elements (px). */
  gap?: number;
  /** Text alignment. */
  textAlign?: "left" | "center" | "right";
}

// ── SVG string builder ──────────────────────────────────────────────────────

/**
 * Render an SVG element tree to a string.
 */
export function renderSvg(doc: SvgDocument): string {
  const parts: string[] = [];

  // Deterministic attribute order
  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`,
  );

  // Background
  parts.push(`<rect width="100%" height="100%" fill="#1a1a2e"/>`);

  for (const el of doc.elements) {
    parts.push(renderElement(el, 1));
  }

  parts.push("</svg>");

  return parts.join("\n") + "\n";
}

function renderElement(el: SvgElement, indent: number): string {
  const pad = "  ".repeat(indent);
  const attrStr = Object.entries(el.attrs)
    .sort(([a], [b]) => a.localeCompare(b)) // Deterministic order
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");

  if (el.children && el.children.length > 0) {
    const children = el.children
      .map((c) => (typeof c === "string" ? `${pad}  ${escapeText(c)}` : renderElement(c, indent + 1)))
      .join("\n");
    return `${pad}<${el.tag}${attrStr}>\n${children}\n${pad}</${el.tag}>`;
  }

  if (el.text) {
    return `${pad}<${el.tag}${attrStr}>${escapeText(el.text)}</${el.tag}>`;
  }

  return `${pad}<${el.tag}${attrStr}/>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Layout primitives ──────────────────────────────────────────────────────

/**
 * Create a centered text element.
 */
export function text(
  x: number,
  y: number,
  content: string,
  style: TextStyle = {},
): SvgElement {
  const fontSize = style.fontSize ?? 24;
  const attrs: Record<string, string> = {
    x: String(x),
    y: String(y),
    "font-family": style.fontFamily ?? "system-ui, sans-serif",
    "font-size": `${fontSize}px`,
    "font-weight": String(style.fontWeight ?? "normal"),
    fill: style.fill ?? "#e0e0e0",
  };
  if (style.textAnchor) attrs["text-anchor"] = style.textAnchor;
  if (style.dominantBaseline) attrs["dominant-baseline"] = style.dominantBaseline;

  return { tag: "text", attrs, text: content };
}

/**
 * Create a rounded rectangle.
 */
export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  fill?: string,
  stroke?: string,
  rx?: number,
): SvgElement {
  const attrs: Record<string, string> = {
    x: String(x),
    y: String(y),
    width: String(width),
    height: String(height),
  };
  if (fill) attrs.fill = fill;
  if (stroke) attrs.stroke = stroke;
  if (rx !== undefined) attrs.rx = String(rx);

  return { tag: "rect", attrs };
}

/**
 * Create a line element.
 */
export function line(
  x1: number, y1: number,
  x2: number, y2: number,
  stroke = "#444",
  strokeWidth = 1,
): SvgElement {
  return {
    tag: "line",
    attrs: {
      x1: String(x1), y1: String(y1),
      x2: String(x2), y2: String(y2),
      stroke, "stroke-width": String(strokeWidth),
    },
  };
}

/**
 * Create a group container.
 */
export function group(children: (SvgElement | string)[], attrs: Record<string, string> = {}): SvgElement {
  return { tag: "g", attrs, children };
}

// ── Title card layout ──────────────────────────────────────────────────────

export interface TitleCard {
  width: number;
  height: number;
  title: string;
  subtitle?: string;
  backgroundColor?: string;
  titleColor?: string;
  subtitleColor?: string;
}

export function titleCardLayout(card: TitleCard): SvgDocument {
  const bg = card.backgroundColor ?? "#1a1a2e";
  const titleColor = card.titleColor ?? "#ff6b35";
  const subColor = card.subtitleColor ?? "#a0a0b0";

  const cx = card.width / 2;
  const cy = card.height / 2;

  const elements: SvgElement[] = [
    rect(0, 0, card.width, card.height, bg),
    text(cx, cy - 24, card.title, {
      fontSize: 48,
      fontWeight: "bold",
      fill: titleColor,
      textAnchor: "middle",
      dominantBaseline: "middle",
    }),
  ];

  if (card.subtitle) {
    elements.push(text(cx, cy + 36, card.subtitle, {
      fontSize: 24,
      fill: subColor,
      textAnchor: "middle",
      dominantBaseline: "middle",
    }));
  }

  return { width: card.width, height: card.height, elements };
}

// ── Quote card layout ──────────────────────────────────────────────────────

export interface QuoteCard {
  width: number;
  height: number;
  quote: string;
  attribution?: string;
}

export function quoteCardLayout(card: QuoteCard): SvgDocument {
  const cx = card.width / 2;
  const cy = card.height / 2;

  const elements: SvgElement[] = [
    rect(0, 0, card.width, card.height, "#1a1a2e"),
    // Decorative quote mark
    text(60, cy - 60, "\u201C", {
      fontSize: 96,
      fill: "#ff6b35",
      textAnchor: "start",
      dominantBaseline: "hanging",
    }),
    text(cx, cy - 20, card.quote, {
      fontSize: 28,
      fill: "#e0e0e0",
      textAnchor: "middle",
      dominantBaseline: "middle",
    }),
  ];

  if (card.attribution) {
    elements.push(text(cx, cy + 60, `\u2014 ${card.attribution}`, {
      fontSize: 20,
      fill: "#a0a0b0",
      textAnchor: "middle",
      dominantBaseline: "top",
    }));
  }

  return { width: card.width, height: card.height, elements };
}

// ── Layout container ───────────────────────────────────────────────────────

/**
 * Stack elements vertically with padding and gaps.
 */
export function vstack(
  elements: SvgElement[],
  bounds: Rect,
  options: LayoutOptions = {},
): SvgElement[] {
  const padding = options.padding ?? 20;
  const gap = options.gap ?? 12;
  const align = options.textAlign ?? "left";

  let y = bounds.y + padding;
  void bounds.width; // availableWidth

  const positioned: SvgElement[] = [];

  for (const el of elements) {
    let x = bounds.x + padding;
    if (align === "center") x = bounds.x + bounds.width / 2;
    if (align === "right") x = bounds.x + bounds.width - padding;

    // Clone with updated position
    const attrs = { ...el.attrs };
    attrs.x = String(x);
    attrs.y = String(y);

    if (align === "center" && !attrs["text-anchor"]) {
      attrs["text-anchor"] = "middle";
    }
    if (align === "right" && !attrs["text-anchor"]) {
      attrs["text-anchor"] = "end";
    }

    positioned.push({ ...el, attrs });
    y += (Number((el.attrs["font-size"] ?? "24").replace("px", ""))) + gap;
  }

  return positioned;
}
