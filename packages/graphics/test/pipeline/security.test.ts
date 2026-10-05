import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { SVGRenderPipeline } from '../../src/pipeline/renderer.js';
import { renderSvg, text } from '../../src/pipeline/svg-primitives.js';
import type { GraphicRenderRequest } from '../../src/models/request.js';
import type { SvgDocument, SvgElement } from '../../src/pipeline/svg-primitives.js';
import { createFontRegistry, BUNDLED_FONTS } from '../../src/font/registry.js';
import { GRAPHICS_LIMITS, GraphicsSafetyError, checkSvgSize } from '../../src/pipeline/safety.js';
import { performance } from 'node:perf_hooks';
import { Resvg } from '@resvg/resvg-js';

const pipeline = new SVGRenderPipeline({
  fontResolver: { resolve() { throw new Error('must not resolve external fonts'); } },
  imageResolver: { resolve() { throw new Error('must not read images'); } },
});
const request = { kind: 'title-frame', width: 400, height: 200, content: { title: 'Safe' } };

async function rejected(value: unknown, code?: string) {
  const result = await pipeline.render(value as GraphicRenderRequest);
  assert.equal(result.status, 'failed');
  assert.ok(result.svgContent.includes('<svg'));
  assert.doesNotMatch(result.svgContent, /NaN|Infinity|undefined/);
  if (code) assert.ok(result.diagnostics.some(d => d.code === code), JSON.stringify(result.diagnostics));
  return result;
}

describe('graphics untrusted input regression tests', () => {
  it('returns diagnostics instead of throwing on malformed JSON-shaped requests', async () => {
    for (const value of [null, [], {}, { ...request, content: null },
      { ...request, content: { title: 42 } }, { ...request, kind: 'script' },
      { ...request, width: '400" onload="alert(1)' }]) await rejected(value);
  });

  it('rejects cyclic requests before canonical hashing', async () => {
    const value = { ...request, metadata: {} as Record<string, unknown> };
    value.metadata.self = value;
    await rejected(value);
  });

  it('rejects unsafe CSS paint values rather than escaping a live URL', async () => {
    await rejected({ kind: 'simple-chart', width: 400, height: 200,
      content: { chartType: 'bar', data: [{ label: 'A', value: 1, color: 'url(https://example.invalid/paint.svg#x)' }] } });
  });

  it('bounds dimensions, code line count and collections', async () => {
    await rejected({ ...request, width: 1e9 });
    await rejected({ kind: 'code-frame', width: 400, height: 200,
      content: { language: 'ts', code: '\n'.repeat(5000) } });
    await rejected({ kind: 'architecture-diagram', width: 400, height: 200,
      content: { diagramType: 'architecture', nodes: Array.from({ length: 1000 }, (_, i) =>
        ({ id: String(i), label: 'N', kind: 'process' })), edges: [] } });
  });

  it('rejects script, foreignObject, event handlers and external image references', () => {
    for (const element of [
      { tag: 'script', attrs: {}, text: 'alert(1)' },
      { tag: 'foreignObject', attrs: {}, text: 'html' },
      { tag: 'text', attrs: { onload: 'alert(1)' }, text: 'Hello' },
      ...['../secret.png', '/etc/passwd', 'file:///etc/passwd', 'https://example.invalid/a.png',
        'data:image/svg+xml,<svg onload="alert(1)"/>'].map(href => ({ tag: 'image', attrs: { href } })),
    ]) assert.throws(() => renderSvg({ width: 400, height: 200, elements: [element] }));
  });

  it('keeps hostile markup inert as text', async () => {
    const title = '</text><script>alert(1)</script><foreignObject/> & "quoted"';
    const result = await pipeline.render({ ...request, content: { title } } as GraphicRenderRequest);
    assert.equal(result.status, 'success');
    assert.doesNotMatch(result.svgContent, /<script|<foreignObject/);
    assert.ok(result.svgContent.includes('&lt;script&gt;'));
    const svg = renderSvg({ width: 400, height: 200, elements: [text(10, 20, title)] });
    assert.doesNotMatch(svg, /<script|<foreignObject/);
  });

  it('validates every kind and closes nested records', async () => {
    for (const value of [
      { ...request, style: 'background: url(https://example.invalid)' },
      { ...request, content: { title: 'Safe', onload: 'alert(1)' } },
      { ...request, safeArea: { top: -1, right: 0, bottom: 0, left: 0 } },
      { ...request, safeArea: { top: 100, right: 0, bottom: 100, left: 0 } },
      { ...request, metadata: { image: { href: '../outside.png' } } },
      { kind: 'callout', width: 400, height: 200, content: { text: 1 } },
      { kind: 'comparison-layout', width: 400, height: 200,
        content: { leftTitle: 'L', rightTitle: 'R', leftSections: [{ body: [] }], rightSections: [] } },
      { kind: 'architecture-diagram', width: 400, height: 200,
        content: { diagramType: 'architecture', nodes: [{ id: 'a', label: 'A', kind: 'unknown' }], edges: [] } },
      { kind: 'infographic-primitive', width: 400, height: 200,
        content: { primitiveType: 'unknown', properties: {} } },
      { kind: 'simple-chart', width: 400, height: 200,
        content: { chartType: 'bar', data: [{ label: 'A', value: Infinity }] } },
      { ...request, width: 8192, height: 8192 },
      { ...request, width: Number.MIN_VALUE },
    ]) await rejected(value);
  });

  it('rejects XML controls, accessors, prototype keys and non-JSON values without executing code', async () => {
    let called = false;
    const getter = { ...request, content: Object.defineProperty({}, 'title', {
      enumerable: true, get() { called = true; throw new Error('getter executed'); },
    }) };
    for (const value of [getter, { ...request, content: { title: '\u0000' } },
      { ...request, content: { title: '\ud800' } },
      { ...request, metadata: JSON.parse('{"__proto__":{"polluted":true}}') },
      { ...request, metadata: { x: BigInt(1) } },
      { ...request, content: new Date() }, { ...request, metadata: { [Symbol('x')]: 'x' } },
    ]) await rejected(value);
    assert.equal(called, false);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it('bounds individual strings, total characters and primitive tree depth', async () => {
    await rejected({ ...request, content: { title: 'x'.repeat(GRAPHICS_LIMITS.maxStringLength + 1) } }, 'resource.text-limit');
    await rejected({ ...request, metadata: { a: 'x'.repeat(50_000), b: 'x'.repeat(50_000), c: 'x'.repeat(50_000) } }, 'resource.text-limit');
    let node: SvgElement = text(0, 0, 'End');
    for (let i = 0; i < 30; i++) node = { tag: 'g', attrs: {}, children: [node] };
    assert.throws(() => renderSvg({ width: 400, height: 200, elements: [node] }), GraphicsSafetyError);
    const cycle: SvgElement = { tag: 'g', attrs: {}, children: [] };
    cycle.children!.push(cycle);
    assert.throws(() => renderSvg({ width: 400, height: 200, elements: [cycle] }), GraphicsSafetyError);
    assert.throws(() => checkSvgSize('x'.repeat(GRAPHICS_LIMITS.maxSvgBytes + 1)), GraphicsSafetyError);
  });

  it('rejects CSS, attribute-name injection, URL paints, unsafe paths and invalid geometry in primitives', () => {
    for (const attrs of [
      { style: 'background:url(https://example.invalid)' }, { 'x" onload="': 'alert(1)' },
      { fill: 'url(https://example.invalid/paint.svg)' }, { fill: 'url(../secret.svg#paint)' },
      { fill: 'url(#paint)' }, { 'font-family': 'Inter; @font-face {src:url(https://example.invalid)}' },
      { x: 'NaN' }, { x: '1e999' }, { 'font-size': '100000000px' },
    ]) assert.throws(() => renderSvg({ width: 400, height: 200, elements: [{ tag: 'text', attrs, text: 'Safe' }] }), GraphicsSafetyError);
    assert.throws(() => renderSvg({ width: 400, height: 200,
      elements: [{ tag: 'path', attrs: { d: 'M1e999,0 L0,0' } }] }), GraphicsSafetyError);
    assert.throws(() => renderSvg({ width: NaN, height: 200, elements: [] }), GraphicsSafetyError);
  });

  it('does not let injected font specifications introduce CSS or remote references', async () => {
    const font = structuredClone(BUNDLED_FONTS.find(f => f.role === 'body')!);
    font.variants[0].cssSpec = 'url(https://example.invalid/font.woff)';
    const fonts = createFontRegistry([font]);
    const unsafe = new SVGRenderPipeline({ fontResolver: { resolve() { throw new Error('unused'); } },
      imageResolver: { resolve() { throw new Error('unused'); } }, fontRegistry: fonts });
    const result = await unsafe.render(request);
    assert.equal(result.status, 'failed');
    assert.ok(result.diagnostics.some(d => d.code === 'security.unsafe-font'));
    assert.ok(!result.svgContent.includes('example.invalid'));
  });

  it('honors pre-cancellation and cooperative deadlines without timer races', async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await pipeline.render(request, { signal: controller.signal });
    assert.equal(cancelled.status, 'failed');
    assert.ok(cancelled.diagnostics.some(d => d.code === 'resource.cancelled'));
    let clock = 0;
    const mocked = mock.method(performance, 'now', () => clock += GRAPHICS_LIMITS.maxRenderMs + 1);
    try {
      await rejected(request, 'resource.render-time-limit');
      assert.throws(() => renderSvg({ width: 400, height: 200, elements: [] }),
        (e: unknown) => e instanceof GraphicsSafetyError && e.code === 'resource.render-time-limit');
    } finally { mocked.mock.restore(); }
    assert.equal((await pipeline.render(request)).status, 'success', 'failure must not poison later renders');
  });

  it('renders an injection corpus as inert XML in every supported content surface', async () => {
    const corpus = ['<script>alert(1)</script>', '<foreignObject><iframe src="https://example.invalid"/></foreignObject>',
      '<!DOCTYPE svg [<!ENTITY leak SYSTEM "file:///etc/passwd">]>&leak;',
      '" onload="alert(1)', '<style>@import url(https://example.invalid/font.css)</style>'];
    for (const payload of corpus) {
      const variants = [
        { kind: 'title-frame', content: { title: payload } },
        { kind: 'code-frame', content: { language: 'txt', code: payload } },
        { kind: 'callout', content: { text: payload, icon: payload } },
        { kind: 'comparison-layout', content: { leftTitle: payload, rightTitle: payload,
          leftSections: [{ heading: payload, body: payload }], rightSections: [] } },
        { kind: 'architecture-diagram', content: { diagramType: 'flowchart',
          nodes: [{ id: 'a', label: payload, kind: 'process' }], edges: [] } },
        { kind: 'simple-chart', content: { chartType: 'bar', title: payload, data: [{ label: payload, value: 1 }] } },
        { kind: 'infographic-primitive', content: { primitiveType: 'badge', properties: { label: payload } } },
      ];
      for (const variant of variants) {
        const result = await pipeline.render({ width: 400, height: 200, ...variant });
        assert.equal(result.status, 'success');
        assert.doesNotMatch(result.svgContent, /<script|<foreignObject|<iframe|<style|<!DOCTYPE|<!ENTITY/);
        assert.doesNotThrow(() => new Resvg(result.svgContent, { font: { loadSystemFonts: false } }).render());
      }
    }
  });

  it('accepts bounded large fixtures and literal colors without changing determinism', async () => {
    const nodes = Array.from({ length: GRAPHICS_LIMITS.maxDiagramNodes }, (_, i) =>
      ({ id: `n${i}`, label: `Node ${i}`, kind: 'process' }));
    const edges = Array.from({ length: GRAPHICS_LIMITS.maxDiagramEdges }, (_, i) =>
      ({ from: `n${i % nodes.length}`, to: `n${(i + 1) % nodes.length}` }));
    const diagram = { kind: 'architecture-diagram', width: 1920, height: 1080,
      content: { diagramType: 'architecture', nodes, edges } };
    const first = await pipeline.render(diagram);
    const second = await pipeline.render(diagram);
    assert.equal(first.status, 'success');
    assert.equal(first.svgContent, second.svgContent);
    assert.equal(first.requestHash, second.requestHash);
    const code = await pipeline.render({ kind: 'code-frame', width: 1920, height: 1080,
      content: { language: 'txt', code: Array(GRAPHICS_LIMITS.maxCodeLines).fill('é🙂 <safe>').join('\n') } });
    assert.equal(code.status, 'success');
    const chart = await pipeline.render({ kind: 'simple-chart', width: 400, height: 200,
      content: { chartType: 'bar', data: ['#abc', '#abcd', '#112233', '#11223344', 'red'].map(color =>
        ({ label: color, color, value: 1 })) } });
    assert.equal(chart.status, 'success');
    await rejected({ ...diagram, content: { ...diagram.content, nodes: [nodes[0], nodes[0]] } }, 'validation.invalid-node-id');
  });

  it('handles seeded malformed-input fuzzing without throwing or invoking resolvers', async () => {
    let state = 0x5afe;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
    const atoms: unknown[] = [null, undefined, false, 42, 'https://example.invalid', '../outside.png',
      '<script/>', {}, [], Infinity, '\u0000'];
    const value = (depth: number): unknown => {
      if (depth === 0 || random() % 3 === 0) return atoms[random() % atoms.length];
      if (random() % 2) return [value(depth - 1), value(depth - 1)];
      return { title: value(depth - 1), text: value(depth - 1) };
    };
    for (let i = 0; i < 200; i++) {
      const input = i % 2 ? { ...request, content: value(3) } : value(4);
      const result = await pipeline.render(input);
      assert.equal(result.status, 'failed');
      assert.doesNotThrow(() => new Resvg(result.svgContent, { font: { loadSystemFonts: false } }));
      assert.throws(() => renderSvg(input as SvgDocument), GraphicsSafetyError);
    }
    assert.equal((await pipeline.render(request)).status, 'success');
  });
});
