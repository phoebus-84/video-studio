import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {browserLanes, retryStart, startFailed} from '../src/cached-render.js';
import {cachedVideo, planVideo} from '../src/render-cache.js';
import {cacheTimeline} from './cache-fixture.js';

// A browser that only counts its closes: no Chrome is started.
const fakeBrowsers = (fails: number) => {
  const log = {opens: 0, closes: 0};
  const open = async () => {
    log.opens++;
    if (fails-- > 0) throw new Error('Failed to launch the browser process');
    return {close: async () => { log.closes++; }};
  };
  return {log, open};
};

const render = async (lanes: ReturnType<typeof browserLanes>, retries?: number) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lanes-'));
  try {
    return await cachedVideo({
      plan: planVideo(cacheTimeline(), 'r'), cacheDir: path.join(root, 'cache'), work: await mkdtemp(path.join(root, 'work-')), retries,
      renderRun: async (segments, outputs, _progress, lane) => {
        // As renderWithCache: a run that failed drops its lane's browser.
        try { await lanes.get(lane); } catch (error) { await lanes.drop(lane); throw error; }
        await Promise.all(segments.map((s, i) => writeFile(outputs[i]!, s.key)));
      },
      concatenate: async (_files, output) => { await writeFile(output, 'joined'); },
    });
  } finally {
    await lanes.closeAll();
    await rm(root, {recursive: true, force: true});
  }
};

describe('browser lanes', () => {
  it('opens a new browser for the run drawn again after Chrome could not start', async () => {
    const {log, open} = fakeBrowsers(1);
    const result = await render(browserLanes(open));
    assert.equal(log.opens, 2, 'the rejected launch is not awaited again');
    assert.equal(result.report.segmentsRendered, 3);
    assert.match(result.report.warnings.join('\n'), /drawn again after: Failed to launch/);
    assert.equal(log.closes, 1, 'the browser that opened is closed at the end');
  });

  it('fails the render once the retries are spent', async () => {
    const {log, open} = fakeBrowsers(5);
    await assert.rejects(render(browserLanes(open)), /Failed to launch/);
    assert.equal(log.opens, 2, 'one start, one retry');
  });

  it('reuses a lane browser across runs, and closes a dropped one', async () => {
    const {log, open} = fakeBrowsers(0);
    const lanes = browserLanes(open);
    assert.equal(await lanes.get(0), await lanes.get(0));
    await lanes.drop(0);
    assert.equal(log.closes, 1, 'a crashed browser is closed, not left running');
    await lanes.get(0);
    await lanes.closeAll();
    assert.deepEqual(log, {opens: 2, closes: 2});
  });
});

describe('FFmpeg start retries', () => {
  const code = (value: unknown) => Object.assign(new Error('quit'), {code: value});

  it('tells a start that failed from a failed encode', () => {
    for (const value of [3221225794, -1073741502, 'EAGAIN', 'ENOMEM', 'EMFILE', 'ENFILE']) assert.ok(startFailed(code(value)), String(value));
    for (const value of [1, 'ENOENT', 'EACCES', undefined]) assert.ok(!startFailed(code(value)), String(value));
  });

  it('starts again with a growing pause, up to the limit', async () => {
    const pauses: number[] = [];
    let starts = 0;
    await assert.rejects(retryStart(async () => { starts++; throw code(3221225794); }, 3, async (ms) => { pauses.push(ms); }), /quit/);
    assert.equal(starts, 3);
    assert.deepEqual(pauses, [2000, 4000]);
    starts = 0;
    assert.equal(await retryStart(async () => (++starts < 2 ? Promise.reject(code('EAGAIN')) : 'ok'), 3, async () => {}), 'ok');
  });

  it('does not start again after a failure that is not a start', async () => {
    let starts = 0;
    await assert.rejects(retryStart(async () => { starts++; throw code(1); }, 3, async () => {}));
    assert.equal(starts, 1);
  });
});
