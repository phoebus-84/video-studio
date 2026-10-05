import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {listKits} from '../src/kits/registry.js';
import {validateTimeline} from '../src/validate.js';
import {clone, fixture} from './helpers.js';

const problems = (doc: unknown) => {
  const result = validateTimeline(doc);
  return result.ok ? [] : result.problems.map((p) => [p.code, p.path]);
};

describe('validateTimeline', () => {
  it('accepts the migrated explainer, which uses only still and captions', () => {
    assert.deepEqual(problems(fixture('explainer.json')), []);
  });

  it('refuses kits it does not have, by name or by version', () => {
    // The lesson excerpt uses sala, interprete and verse-bar, which avg-tk7.3 and later issues add.
    const codes = new Set(problems(fixture('lesson-excerpt.json')).map(([code]) => code));
    assert.deepEqual([...codes], ['unknown-kit']);
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit.version = '2.0.0';
    assert.deepEqual(problems(doc), [['unknown-kit', '$.tracks[0].items[0].kit']]);
  });

  it('refuses props a kit does not accept, at the offending field', () => {
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[1].props.fit = 'stretch';
    assert.deepEqual(problems(doc), [['bad-props', '$.tracks[0].items[1].props.fit']]);
    const unknown = clone(fixture('explainer.json'));
    unknown.tracks[1].items[0].props.colour = 'red';
    assert.deepEqual(problems(unknown).map(([code]) => code), ['bad-props']);
  });

  it('reports a malformed timeline as invalid-timeline', () => {
    assert.deepEqual(problems({kind: 'EditTimeline'}).map(([code]) => code)[0], 'invalid-timeline');
  });

  it('lists its three kits', () => {
    assert.deepEqual(listKits(), [
      {name: 'still', version: '1.0.0'},
      {name: 'clip', version: '1.0.0'},
      {name: 'captions', version: '1.0.0'},
    ]);
  });
});
