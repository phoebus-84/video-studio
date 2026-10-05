import type { GraphicRenderRequest } from '../models/request.js';

/** Hard ceilings for the in-memory SVG renderer, not an OS memory sandbox. */
export const GRAPHICS_LIMITS = Object.freeze({
  maxDimension: 8192,
  maxPixels: 16_777_216,
  maxDepth: 16,
  maxValues: 16_384,
  maxObjectKeys: 128,
  maxArrayLength: 1024,
  maxStringLength: 65_536,
  maxCharacters: 131_072,
  maxCodeLines: 1024,
  maxDiagramNodes: 256,
  maxDiagramEdges: 1024,
  maxChartPoints: 256,
  maxSections: 128,
  maxSvgNodes: 4096,
  maxSvgBytes: 2_097_152,
  maxRenderMs: 1000,
});

export class GraphicsSafetyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'GraphicsSafetyError';
  }
}

function reject(code: string, message: string): never {
  throw new GraphicsSafetyError(code, message);
}

/** Only passive JSON-like data. Snapshot before hashing or kind dispatch.
 * Getters, class instances, cycles and excessive expansion are rejected.
 * Proxies / hostile code executing in the same process are not a sandbox target.
 */
export function boundedSnapshot(input: unknown): unknown {
  let values = 0;
  let characters = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (++values > GRAPHICS_LIMITS.maxValues || depth > GRAPHICS_LIMITS.maxDepth) {
      reject('resource.input-complexity', 'Input exceeds the value count or nesting limit');
    }
    if (typeof value === 'string') {
      characters += value.length;
      if (value.length > GRAPHICS_LIMITS.maxStringLength || characters > GRAPHICS_LIMITS.maxCharacters) {
        reject('resource.text-limit', 'Input exceeds the string or total character limit');
      }
      // XML 1.0 cannot represent these controls or unpaired UTF-16 surrogates.
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)) {
        reject('validation.invalid-text', 'Text must contain only valid XML 1.0 characters');
      }
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) reject('validation.non-finite-number', 'Numbers must be finite');
      return value;
    }
    if (value === null || value === undefined || typeof value === 'boolean') return value;
    if (typeof value !== 'object') reject('validation.invalid-data', 'Input must contain only JSON-like data');
    if (ancestors.has(value)) reject('validation.cyclic-input', 'Input must not contain cycles');
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (!array && proto !== Object.prototype && proto !== null) {
      reject('validation.invalid-data', 'Objects must be plain data records');
    }
    if (Object.getOwnPropertySymbols(value).length) reject('validation.invalid-data', 'Symbol keys are not supported');
    if (array && value.length > GRAPHICS_LIMITS.maxArrayLength) {
      reject('resource.collection-limit', 'Array exceeds the collection limit');
    }
    const keys = Object.keys(value);
    if (!array && keys.length > GRAPHICS_LIMITS.maxObjectKeys) {
      reject('resource.collection-limit', 'Record exceeds the property count limit');
    }
    if (array && keys.length !== value.length) reject('validation.invalid-data', 'Arrays must be dense without extra properties');
    ancestors.add(value);
    const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    for (const key of keys) {
      if (array && !/^(0|[1-9]\d*)$/.test(key)) reject('validation.invalid-data', 'Array properties must be indices');
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        reject('validation.invalid-data', 'Prototype-related keys are not supported');
      }
      visit(key, depth + 1);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) reject('validation.invalid-data', 'Accessors are not supported');
      (result as Record<string, unknown>)[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return result;
  };
  return visit(input, 0);
}

type Rule = (value: unknown, path: string) => void;
const string: Rule = (v, p) => { if (typeof v !== 'string') reject('validation.invalid-shape', `${p} must be a string`); };
const number: Rule = (v, p) => { if (typeof v !== 'number' || !Number.isFinite(v)) reject('validation.invalid-shape', `${p} must be a finite number`); };
const boolean: Rule = (v, p) => { if (typeof v !== 'boolean') reject('validation.invalid-shape', `${p} must be a boolean`); };
const positiveInteger: Rule = (v, p) => {
  number(v, p);
  if (!Number.isSafeInteger(v) || (v as number) <= 0) reject('validation.invalid-shape', `${p} must be a positive integer`);
};
const oneOf = (...allowed: string[]): Rule => (v, p) => {
  if (!allowed.includes(v as string)) reject('validation.invalid-shape', `${p} has an unsupported value`);
};
const list = (item: Rule, max: number): Rule => (v, p) => {
  if (!Array.isArray(v)) reject('validation.invalid-shape', `${p} must be an array`);
  if (v.length > max) reject('resource.collection-limit', `${p} exceeds its item limit (${max})`);
  v.forEach((entry, i) => item(entry, `${p}[${i}]`));
};
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('validation.invalid-shape', `${path} must be a record`);
  return value as Record<string, unknown>;
}
const shape = (required: Record<string, Rule>, optional: Record<string, Rule> = {}): Rule => (v, p) => {
  const data = record(v, p);
  for (const key of Object.keys(data)) {
    if (!Object.hasOwn(required, key) && !Object.hasOwn(optional, key)) {
      reject('validation.unknown-property', `${p} contains unsupported property ${key}`);
    }
  }
  for (const [key, rule] of Object.entries(required)) rule(data[key], `${p}.${key}`);
  for (const [key, rule] of Object.entries(optional)) if (data[key] !== undefined) rule(data[key], `${p}.${key}`);
};
const stringRecord: Rule = (v, p) => {
  for (const [key, value] of Object.entries(record(v, p))) string(value, `${p}.${key}`);
};
const scalarRecord: Rule = (v, p) => {
  for (const [key, value] of Object.entries(record(v, p))) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) reject('validation.invalid-shape', `${p}.${key} must be a scalar`);
  }
};

/** A deliberately small paint vocabulary: no CSS functions or URL references. */
export function isSafePaint(value: string): boolean {
  return /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|[a-z]+)$/i.test(value);
}

/** Font names only, not CSS rules, URLs, escapes or @font-face declarations. */
export function isSafeFontFamily(value: string): boolean {
  return value.length <= 512 && /^(?:[a-z0-9_-]+(?: [a-z0-9_-]+)*|'[a-z0-9 _-]+'|"[a-z0-9 _-]+")(?:\s*,\s*(?:[a-z0-9_-]+(?: [a-z0-9_-]+)*|'[a-z0-9 _-]+'|"[a-z0-9 _-]+"))*$/i.test(value);
}
const paint: Rule = (v, p) => {
  string(v, p);
  if (!isSafePaint(v as string)) reject('security.unsafe-paint', `${p} must be a literal color, never CSS or a URL`);
};

const section = shape({ body: string }, { heading: string });
const contentRules: Record<GraphicRenderRequest['kind'], Rule> = {
  'code-frame': shape({ language: string, code: string }, {
    highlightLines: list(positiveInteger, GRAPHICS_LIMITS.maxCodeLines), showLineNumbers: boolean, maxLines: positiveInteger,
  }),
  'architecture-diagram': shape({
    diagramType: oneOf('flowchart', 'architecture', 'sequence'),
    nodes: list(shape({ id: string, label: string, kind: oneOf('process', 'decision', 'data', 'start', 'end') }), GRAPHICS_LIMITS.maxDiagramNodes),
    edges: list(shape({ from: string, to: string }, { label: string }), GRAPHICS_LIMITS.maxDiagramEdges),
  }, { layout: oneOf('top-to-bottom', 'left-to-right') }),
  'title-frame': shape({ title: string }, { subtitle: string, alignment: oneOf('left', 'center', 'right') }),
  callout: shape({ text: string }, { icon: string, severity: oneOf('info', 'warning', 'tip', 'note') }),
  'comparison-layout': shape({ leftTitle: string, rightTitle: string,
    leftSections: list(section, GRAPHICS_LIMITS.maxSections), rightSections: list(section, GRAPHICS_LIMITS.maxSections) }),
  'simple-chart': shape({ chartType: oneOf('bar', 'line', 'pie'),
    data: list(shape({ label: string, value: number }, { color: paint }), GRAPHICS_LIMITS.maxChartPoints) }, { title: string }),
  'infographic-primitive': shape({ primitiveType: oneOf('icon', 'badge', 'step-indicator', 'stat-card'), properties: scalarRecord }),
};

export function validateDimensions(width: unknown, height: unknown): void {
  for (const [key, value] of [['width', width], ['height', height]] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
      reject(`validation.invalid-${key}`, `${key} must be a finite number of at least 1 pixel`);
    }
    if (value > GRAPHICS_LIMITS.maxDimension) reject('resource.dimension-limit', 'Frame exceeds the dimension limit');
  }
  if ((width as number) * (height as number) > GRAPHICS_LIMITS.maxPixels) {
    reject('resource.pixel-limit', 'Frame exceeds the pixel area limit');
  }
}

/** Runtime mirror of the public discriminated request types, with closed records. */
export function parseGraphicRequest(input: unknown): GraphicRenderRequest {
  const snapshot = boundedSnapshot(input);
  const data = record(snapshot, 'request');
  validateDimensions(data.width, data.height);
  shape({ kind: oneOf(...Object.keys(contentRules)), width: number, height: number, content: (v, p) => {
    contentRules[data.kind as GraphicRenderRequest['kind']](v, p);
  } }, { themeId: string, idempotencyKey: string, metadata: stringRecord,
    safeArea: shape({ top: number, right: number, bottom: number, left: number }) })(data, 'request');
  const request = data as unknown as GraphicRenderRequest;
  if (request.safeArea) {
    const a = request.safeArea;
    if (Object.values(a).some(v => v < 0) || a.left + a.right >= request.width || a.top + a.bottom >= request.height) {
      reject('validation.invalid-safe-area', 'Safe area must be non-negative and leave a positive inner frame');
    }
  }
  if (request.kind === 'architecture-diagram') {
    const nodes = (request.content as { nodes: { id: string }[] }).nodes;
    const ids = new Set<string>();
    for (const node of nodes) {
      if (!node.id.trim() || ids.has(node.id)) reject('validation.invalid-node-id', 'Diagram node IDs must be non-empty and unique');
      ids.add(node.id);
    }
  }
  if (request.kind === 'code-frame') {
    const content = request.content as { code: string };
    let lines = 1;
    for (const char of content.code) if (char === '\n' && ++lines > GRAPHICS_LIMITS.maxCodeLines) {
      reject('resource.code-line-limit', 'Code exceeds the line limit');
    }
  }
  return request;
}

/** A post-build cap; preflight limits bound all allocations leading up to it. */
export function checkSvgSize(svg: string): void {
  if (Buffer.byteLength(svg, 'utf8') > GRAPHICS_LIMITS.maxSvgBytes) {
    reject('resource.svg-size-limit', 'SVG exceeds the output byte limit');
  }
}
