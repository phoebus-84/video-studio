import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {videoFrames} from '../src/probe.js';

describe('videoFrames', () => {
  it('returns Infinity, never throws, when ffprobe is not installed', () => {
    const before = process.env.FFPROBE_PATH;
    process.env.FFPROBE_PATH = '/nonexistent/ffprobe';
    try {
      assert.equal(videoFrames('/nonexistent/clip.mp4', 30), Number.POSITIVE_INFINITY);
    } finally {
      if (before === undefined) delete process.env.FFPROBE_PATH;
      else process.env.FFPROBE_PATH = before;
    }
  });
});
