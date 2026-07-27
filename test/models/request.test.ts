// ── Request model validation tests ──

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type {
  GraphicRenderRequest,
  CodeFrameContent,
  DiagramContent,
  TitleFrameContent,
} from '../../src/models/request.js';

describe('GraphicRenderRequest types', () => {
  it('accepts a valid code-frame request', () => {
    const req: GraphicRenderRequest = {
      kind: 'code-frame',
      width: 800,
      height: 400,
      content: {
        language: 'typescript',
        code: 'const x: number = 1;',
        showLineNumbers: true,
      } satisfies CodeFrameContent,
    };
    assert.equal(req.kind, 'code-frame');
    assert.equal(req.width, 800);
    assert.equal(req.height, 400);
    const content = req.content as CodeFrameContent;
    assert.equal(content.language, 'typescript');
  });

  it('accepts a valid diagram request', () => {
    const req: GraphicRenderRequest = {
      kind: 'architecture-diagram',
      width: 600,
      height: 400,
      content: {
        diagramType: 'architecture',
        nodes: [
          { id: 'a', label: 'Gateway', kind: 'process' },
          { id: 'b', label: 'DB', kind: 'data' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      } satisfies DiagramContent,
    };
    assert.equal(req.kind, 'architecture-diagram');
    const content = req.content as DiagramContent;
    assert.equal(content.nodes.length, 2);
  });

  it('accepts a valid title-frame request', () => {
    const req: GraphicRenderRequest = {
      kind: 'title-frame',
      width: 1920,
      height: 1080,
      content: {
        title: 'Introduction',
        subtitle: 'Chapter 1',
        alignment: 'center',
      } satisfies TitleFrameContent,
    };
    assert.equal(req.kind, 'title-frame');
    assert.equal(req.width, 1920);
  });

  it('accepts optional fields (themeId, safeArea, metadata, idempotencyKey)', () => {
    const req: GraphicRenderRequest = {
      kind: 'callout',
      width: 400,
      height: 100,
      content: { text: 'Hello', severity: 'info' },
      themeId: 'dark-v1',
      safeArea: { top: 8, right: 8, bottom: 8, left: 8 },
      metadata: { source: 'test' },
      idempotencyKey: 'key-123',
    };
    assert.equal(req.themeId, 'dark-v1');
    assert.deepEqual(req.safeArea, { top: 8, right: 8, bottom: 8, left: 8 });
    assert.deepEqual(req.metadata, { source: 'test' });
    assert.equal(req.idempotencyKey, 'key-123');
  });
});
