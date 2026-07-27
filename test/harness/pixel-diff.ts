// ── SVG regression harness ──
// Includes both structural comparison and true headless pixel comparison.

import { Resvg } from '@resvg/resvg-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface PixelDiffResult {
  equivalent: boolean;
  pixelsChanged: number;
  ratioChanged: number;
  width: number;
  height: number;
}

/**
 * Rasterize two SVG documents with the same pinned resvg binary and compare
 * their RGBA pixels. System fonts and network loading are disabled; callers
 * that compare text must embed or convert their pinned fonts first.
 */
export function svgPixelDiff(a: string, b: string, threshold = 0.1): PixelDiffResult {
  const render = (svg: string): PNG => {
    const pngBytes = new Resvg(svg, {
      font: { loadSystemFonts: false },
    }).render().asPng();
    return PNG.sync.read(Buffer.from(pngBytes));
  };
  const imageA = render(a);
  const imageB = render(b);

  if (imageA.width !== imageB.width || imageA.height !== imageB.height) {
    return {
      equivalent: false,
      pixelsChanged: Math.max(imageA.width * imageA.height, imageB.width * imageB.height),
      ratioChanged: 1,
      width: Math.max(imageA.width, imageB.width),
      height: Math.max(imageA.height, imageB.height),
    };
  }

  const pixelsChanged = pixelmatch(
    imageA.data,
    imageB.data,
    undefined,
    imageA.width,
    imageA.height,
    { threshold },
  );
  const total = imageA.width * imageA.height;
  return {
    equivalent: pixelsChanged === 0,
    pixelsChanged,
    ratioChanged: total === 0 ? 0 : pixelsChanged / total,
    width: imageA.width,
    height: imageA.height,
  };
}

export interface SvgDiffResult {
  /** Whether the two SVGs are structurally equivalent */
  equivalent: boolean;
  /** Number of structural differences found */
  diffCount: number;
  /** Human-readable description of each difference */
  differences: string[];
}

/**
 * Compare two SVG strings for structural equivalence.
 *
 * This is a lightweight structural diff that extracts:
 * - Element tag names and their order
 * - Attribute names and values
 * - Text content
 *
 * Whitespace-only differences in text content are ignored.
 * Comment differences are ignored.
 */
export function svgStructuralDiff(a: string, b: string): SvgDiffResult {
  const differences: string[] = [];

  const elementsA = extractElements(a);
  const elementsB = extractElements(b);

  const maxLen = Math.max(elementsA.length, elementsB.length);
  for (let i = 0; i < maxLen; i++) {
    const elA = elementsA[i];
    const elB = elementsB[i];

    if (!elA && elB) {
      differences.push(`Element ${i}: missing in A, found "${elB.tag}" in B`);
      continue;
    }
    if (elA && !elB) {
      differences.push(`Element ${i}: found "${elA.tag}" in A, missing in B`);
      continue;
    }
    if (elA!.tag !== elB!.tag) {
      differences.push(`Element ${i}: tag mismatch "${elA!.tag}" vs "${elB!.tag}"`);
      continue;
    }

    // Compare attributes (order-independent)
    const keysA = Object.keys(elA!.attrs).sort();
    const keysB = Object.keys(elB!.attrs).sort();
    if (keysA.join(',') !== keysB.join(',')) {
      differences.push(
        `Element ${i} (${elA!.tag}): attribute keys differ: [${keysA.join(', ')}] vs [${keysB.join(', ')}]`,
      );
    } else {
      for (const key of keysA) {
        if (elA!.attrs[key] !== elB!.attrs[key]) {
          differences.push(
            `Element ${i} (${elA!.tag}): attr "${key}" = "${elA!.attrs[key]}" vs "${elB!.attrs[key]}"`,
          );
        }
      }
    }

    // Compare text content (trimmed)
    const textA = (elA!.text ?? '').trim();
    const textB = (elB!.text ?? '').trim();
    if (textA !== textB) {
      differences.push(
        `Element ${i} (${elA!.tag}): text "${truncate(textA)}" vs "${truncate(textB)}"`,
      );
    }
  }

  return {
    equivalent: differences.length === 0,
    diffCount: differences.length,
    differences,
  };
}

// ── Element extraction ──

interface ParsedElement {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

function extractElements(svg: string): ParsedElement[] {
  const elements: ParsedElement[] = [];
  const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9_.-]*)((?:\s+[a-zA-Z][a-zA-Z0-9_.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+))?)*)\s*(\/?)>/g;
  const attrRegex = /([a-zA-Z][a-zA-Z0-9_.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/g;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(svg)) !== null) {
    const isClosing = match[1] === '/';
    const tag = match[2];
    const attrStr = match[3] || '';

    if (isClosing) continue; // skip closing tags for simplicity

    const attrs: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
      const attrName = attrMatch[1];
      const attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
      attrs[attrName] = attrValue;
    }

    // Extract inner text (simplified: everything until next <)
    const afterTag = svg.indexOf('>', match.index) + 1;
    const nextTag = svg.indexOf('<', afterTag);
    const text = nextTag >= 0 ? svg.slice(afterTag, nextTag) : svg.slice(afterTag);

    elements.push({ tag, attrs, text });
  }

  return elements;
}

// ── Pixel-like comparison for SVG layers ──

export interface LayerPresence {
  /** Background rect present */
  hasBackground: boolean;
  /** Foreground text present */
  hasText: boolean;
  /** Border/decorative rect present */
  hasBorder: boolean;
  /** Rendering dimensions */
  width: number;
  height: number;
}

/**
 * Extract rendering-layer information from an SVG.
 * This provides a coarse "pixel-like" check that the
 * major visual elements are present.
 */
export function extractLayerInfo(svg: string): LayerPresence {
  const hasBackground = /<rect[^>]*width\s*=\s*"100%"/i.test(svg);
  const hasText = /<text\b/i.test(svg);
  const hasBorder = /stroke-width/i.test(svg);

  const widthMatch = svg.match(/width\s*=\s*"(\d+)"/);
  const heightMatch = svg.match(/height\s*=\s*"(\d+)"/);

  return {
    hasBackground,
    hasText,
    hasBorder,
    width: widthMatch ? parseInt(widthMatch[1], 10) : 0,
    height: heightMatch ? parseInt(heightMatch[1], 10) : 0,
  };
}

function truncate(s: string, maxLen = 40): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '…';
}
