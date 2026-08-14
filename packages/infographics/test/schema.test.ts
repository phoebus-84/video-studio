import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {getDurationInFrames, parseInfographicSpec} from '../src/schema.js';

const validSpec = {
  version: 1,
  name: 'Test',
  width: 1920,
  height: 1080,
  fps: 30,
  palette: {
    ink: '#0D0B16',
    paper: '#FEFBF6',
    primary: '#423E8E',
    secondary: '#211F47',
    accent: '#D77733',
    muted: '#8A879B',
  },
  scenes: [
    {id: 's1', template: 'title', durationInFrames: 90, title: 'One'},
    {id: 's2', template: 'outro', durationInFrames: 60, title: 'Two'},
  ],
};

describe('infographic spec', () => {
  it('applies defaults and calculates exact duration', () => {
    const spec = parseInfographicSpec(validSpec);
    assert.equal(spec.scenes[0]?.items.length, 0);
    assert.equal(getDurationInFrames(spec), 150);
  });

  it('rejects invalid colors', () => {
    assert.throws(() => parseInfographicSpec({
      ...validSpec,
      palette: {...validSpec.palette, accent: 'orange'},
    }));
  });

  it('rejects frame-unsafe short scenes', () => {
    assert.throws(() => parseInfographicSpec({
      ...validSpec,
      scenes: [{id: 's1', template: 'title', durationInFrames: 5, title: 'Too short'}],
    }));
  });
});
