import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {listKits} from '../src/kits/index.js';
import {validateTimeline} from '../src/validate.js';
import {clone, fixture, outputProfiles} from './helpers.js';

const problems = (doc: unknown) => {
  const result = validateTimeline(doc);
  return result.ok ? [] : result.problems.map((p) => [p.code, p.path]);
};

describe('validateTimeline', () => {
  it('accepts the migrated explainer, which uses only still and captions', () => {
    assert.deepEqual(problems(fixture('explainer.json')), []);
  });

  it('accepts the 9:16 fixture, which uses captions@1.1.0', () => {
    assert.deepEqual(problems(fixture('vertical-short.json')), []);
  });

  it('refuses a resolution that is not its profile\'s', () => {
    const doc = clone(fixture('explainer.json'));
    doc.resolution = {width: 1080, height: 1920};
    assert.deepEqual(problems(doc), [['invalid-timeline', '$.profile']]);
    const result = validateTimeline(doc);
    assert.match(result.ok ? '' : result.problems[0]!.message, /resolution 1080x1920 is not profile "youtube-1920x1080" \(1920x1080\)/);
  });

  it('refuses a safe zone that leaves nothing to draw in, as the contracts do', () => {
    const doc = clone(fixture('vertical-short.json'));
    doc.profile.safeZone.left = 1000;
    doc.profile.safeZone.top = 1600;
    assert.deepEqual(problems(doc), [['invalid-timeline', '$.profile.safeZone'], ['invalid-timeline', '$.profile.safeZone']]);
    const result = validateTimeline(doc);
    assert.deepEqual(result.ok ? [] : result.problems.map((p) => p.message), [
      'profile "vertical-1080x1920": safe zone top 1600 + bottom 380 leaves nothing of height 1920',
      'profile "vertical-1080x1920": safe zone left 1000 + right 140 leaves nothing of width 1080',
    ]);
  });

  it('refuses a timeline without a profile', () => {
    const doc = clone(fixture('explainer.json'));
    delete doc.profile;
    assert.deepEqual(problems(doc), [['invalid-timeline', '$.profile']]);
  });

  it('refuses kits it does not have, by name or by version', () => {
    // The lesson excerpt uses sala, interprete and verse-bar, which avg-tk7.3 and later issues add.
    const codes = new Set(problems(fixture('lesson-excerpt.json')).map(([code]) => code));
    assert.deepEqual([...codes], ['unknown-kit']);
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit.version = '2.0.0';
    assert.deepEqual(problems(doc), [['unknown-kit', '$.tracks[0].items[0].kit']]);
    const result = validateTimeline(doc);
    assert.match(result.ok ? '' : result.problems[0]!.message, /still@2\.0\.0: available still@1\.0\.0/);
  });

  it('refuses a kit drawn for another output profile', () => {
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit = {name: 'title-chip', version: '1.0.0'};
    doc.tracks[0].items[0].props = {title: 'San Martino'};
    assert.deepEqual(problems(doc), [['wrong-profile', '$.tracks[0].items[0].kit']]);
    const result = validateTimeline(doc);
    assert.match(result.ok ? '' : result.problems[0]!.message, /title-chip@1\.0\.0 is drawn for vertical-1080x1920, not youtube-1920x1080/);
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

  it('lists every kit version with what the catalog needs', () => {
    const ids = outputProfiles().map((p) => p.id);
    assert.deepEqual(listKits(ids).map((k) => [k.name, k.version, k.layer]), [
      ['brand-mark', '1.0.0', 'overlay'],
      ['captions', '1.0.0', 'fill'],
      ['captions', '1.1.0', 'overlay'],
      ['clip', '1.0.0', 'fill'],
      ['lower-third', '1.0.0', 'overlay'],
      ['still', '1.0.0', 'fill'],
      ['title-chip', '1.0.0', 'overlay'],
      ['verse-plate', '1.0.0', 'overlay'],
    ]);
    const captions = listKits(ids).find((k) => k.name === 'captions' && k.version === '1.1.0')!;
    assert.deepEqual(captions.examples, ['bottom', 'top', 'center', 'long', 'overflowing']);
    assert.deepEqual(captions.previews, {
      'youtube-1920x1080': 'previews/captions@1.1.0.youtube-1920x1080.png',
      'vertical-1080x1920': 'previews/captions@1.1.0.vertical-1080x1920.png',
    });
    // A format's kit is listed with the profiles it is drawn for, and previews only there.
    const chip = listKits(ids).find((k) => k.name === 'title-chip')!;
    assert.deepEqual([chip.profiles, chip.previews], [['vertical-1080x1920'], {'vertical-1080x1920': 'previews/title-chip@1.0.0.vertical-1080x1920.png'}]);
    assert.deepEqual(listKits()[1]!.previews, {});
    assert.ok(listKits().every((k) => k.description.length > 0));
  });
});
