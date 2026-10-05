import {
  boundedSnapshot, validateDimensions, GraphicsSafetyError, GRAPHICS_LIMITS, isSafePaint, isSafeFontFamily,
} from './safety.js';
import type { SvgDocument, SvgElement } from './svg-primitives.js';

const common = ['id', 'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform'];
const attributes: Record<string, Set<string>> = Object.fromEntries(Object.entries({
  g: [],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  text: ['x', 'y', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  path: ['d'],
  polygon: ['points'],
  polyline: ['points'],
}).map(([tag, attrs]) => [tag, new Set([...common, ...attrs])]));

function fail(message: string): never {
  throw new GraphicsSafetyError('security.unsafe-svg', message);
}
function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('SVG records contain unsupported fields');
}
function numeric(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|%)?$/i.test(value)
    && Number.isFinite(parseFloat(value)) && Math.abs(parseFloat(value)) <= GRAPHICS_LIMITS.maxDimension * 2;
}
function attribute(name: string, value: string): void {
  let safe: boolean;
  switch (name) {
    case 'id': safe = /^[a-z_][a-z0-9_.-]{0,127}$/i.test(value); break;
    case 'fill': case 'stroke': safe = isSafePaint(value); break;
    case 'font-family': safe = isSafeFontFamily(value); break;
    case 'font-weight': safe = /^(normal|bold|[1-9]00)$/.test(value); break;
    case 'text-anchor': safe = /^(start|middle|end)$/.test(value); break;
    case 'dominant-baseline': safe = /^(auto|middle|central|hanging|alphabetic|text-before-edge|text-after-edge|top|bottom)$/.test(value); break;
    case 'd':
      safe = value.length <= 4096 && /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]+$/.test(value)
        && (value.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).every(numeric);
      break;
    case 'points':
      safe = value.length <= 4096 && value.split(/[\s,]+/).filter(Boolean).every(numeric);
      break;
    case 'transform':
      // Small literal transform grammar. No CSS escapes, URL or arbitrary functions.
      safe = value.length <= 512 && /^(?:(?:translate|scale|rotate|matrix)\([0-9eE.,+\s-]+\)\s*)+$/.test(value)
        && (value.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).every(numeric);
      break;
    default: safe = numeric(value);
  }
  if (!safe) fail(`Unsafe value for SVG attribute ${name}`);
}

/** Closed passive SVG subset. No file, URL, image, CSS, entity or script surface. */
export function parseSvgDocument(input: unknown): SvgDocument {
  const doc = boundedSnapshot(input) as Record<string, unknown>;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('SVG document must be a record');
  fields(doc, ['width', 'height', 'elements']);
  validateDimensions(doc.width, doc.height);
  if (!Array.isArray(doc.elements)) fail('SVG elements must be an array');
  let nodes = 0;
  const visit = (value: unknown): void => {
    if (++nodes > GRAPHICS_LIMITS.maxSvgNodes) throw new GraphicsSafetyError('resource.svg-node-limit', 'SVG exceeds its node limit');
    if (typeof value === 'string') return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SVG element must be a record');
    const el = value as Record<string, unknown>;
    fields(el, ['tag', 'attrs', 'children', 'text']);
    if (typeof el.tag !== 'string' || !Object.hasOwn(attributes, el.tag)) fail('Unsupported SVG tag');
    if (!el.attrs || typeof el.attrs !== 'object' || Array.isArray(el.attrs)) fail('SVG attributes must be a record');
    for (const [key, v] of Object.entries(el.attrs)) {
      if (!attributes[el.tag].has(key) || typeof v !== 'string') fail('Unsupported SVG attribute');
      attribute(key, v);
    }
    if (el.text !== undefined && (el.tag !== 'text' || typeof el.text !== 'string')) fail('Only text elements may have text');
    if (el.children !== undefined) {
      if (!['g', 'text'].includes(el.tag) || !Array.isArray(el.children) || el.text !== undefined) fail('Invalid SVG children');
      el.children.forEach(visit);
    }
  };
  for (const el of doc.elements) {
    if (typeof el === 'string') fail('Top-level SVG elements must be records');
    visit(el);
  }
  return doc as unknown as { width: number; height: number; elements: SvgElement[] };
}
