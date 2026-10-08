import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {listKits} from '../src/kits/index.js';
import {DEMO_LOOK} from '../src/kits/lib/look/1.0.0.js';
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
    // The lesson excerpt (a contracts sketch) uses sala, interprete@1.0.0 and verse-bar@1.0.0: sala does
    // not exist, interprete@1.0.0 is drawn for 9:16 only (the lesson's is 1.1.0), and the sketch's
    // verse-bar props are not the real kit's (it takes a look and lines of words).
    const codes = new Set(problems(fixture('lesson-excerpt.json')).map(([code]) => code));
    assert.deepEqual([...codes].sort(), ['bad-props', 'unknown-kit', 'wrong-profile']);
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

  it('accepts a channel-neutral lesson kit with a look in 16:9, and refuses a malformed look at its path', () => {
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit = {name: 'block-title', version: '1.0.0'};
    doc.tracks[0].items[0].props = {look: clone(DEMO_LOOK), kicker: 'CHAPTER I', title: 'THE CONTEXT'};
    assert.deepEqual(problems(doc), []);
    doc.tracks[0].items[0].props.look.colors.accent = 'cyan';
    delete doc.tracks[0].items[0].props.look.fonts.serif;
    assert.deepEqual(problems(doc).sort(), [
      ['bad-props', '$.tracks[0].items[0].props.look.colors.accent'],
      ['bad-props', '$.tracks[0].items[0].props.look.fonts.serif'],
    ]);
  });

  it('refuses a look whose fonts the composer cannot draw: an unbundled family, or one without a role\'s faces', () => {
    const doc = clone(fixture('explainer.json'));
    doc.tracks[0].items[0].kit = {name: 'block-title', version: '1.0.0'};
    doc.tracks[0].items[0].props = {look: clone(DEMO_LOOK), kicker: 'CHAPTER I', title: 'THE CONTEXT'};
    doc.tracks[0].items[0].props.look.fonts.display = 'anton';
    doc.tracks[0].items[0].props.look.fonts.serif = 'Anton';
    assert.deepEqual(problems(doc).sort(), [
      ['bad-props', '$.tracks[0].items[0].props.look.fonts.display'],
      ['bad-props', '$.tracks[0].items[0].props.look.fonts.serif'],
    ]);
  });

  it('refuses panel phases at one instant, and a storm faster than a bolt lasts', () => {
    const doc = clone(fixture('explainer.json'));
    const picture = {kind: 'picture', src: {$asset: 'scene-01-woods'}};
    doc.tracks[0].items[0].kit = {name: 'panel', version: '1.0.0'};
    doc.tracks[0].items[0].props = {look: clone(DEMO_LOOK), phases: [{at: 0, content: picture}, {at: 0, content: picture}]};
    assert.deepEqual(problems(doc), [['bad-props', '$.tracks[0].items[0].props.phases']]);
    doc.tracks[0].items[0].kit = {name: 'room', version: '1.0.0'};
    doc.tracks[0].items[0].props = {look: clone(DEMO_LOOK), room: {image: {$asset: 'scene-01-woods'}, sky: [{poly: [[0, 0], [100, 0], [100, 100]], period: 1}]}};
    assert.deepEqual(problems(doc), [['bad-props', '$.tracks[0].items[0].props.room.sky[0].period']]);
  });

  it('refuses malformed teaching tools at their paths', () => {
    const doc = clone(fixture('explainer.json'));
    const item = doc.tracks[0].items[0];
    const pic = {src: {$asset: 'scene-01-woods'}};
    const look = clone(DEMO_LOOK);
    const refused = (name: string, props: Record<string, unknown>, version = '1.0.0') => {
      item.kit = {name, version};
      item.props = {look, ...props};
      return problems(doc);
    };
    const at = (path: string) => [['bad-props', `$.tracks[0].items[0].props.${path}`]];
    assert.deepEqual(refused('panel', {phases: [{at: 0, layers: [{split: {items: [pic]}}]}]}, '1.1.0'), at('phases[0].layers[0].split.items'));
    assert.deepEqual(refused('text-stack', {x: 0, y: 0, items: [{kind: 'title', text: 'A', at: 0, color: 'red'}]}), at('items[0]'));
    assert.deepEqual(refused('word-tracks', {lines: ['a b.'], read: [2, 1]}), at('read'));
    assert.deepEqual(refused('interlinear', {x: 960, y: 300, width: 900, words: [{text: 'Non', gloss: 'not', at: 0, glossAt: 1}], strike: {indices: [1], at: 2}}), at('strike.indices'));
    assert.deepEqual(refused('monitor-wall', {cells: []}), at('cells'));
    const row = {...pic, keyword: 'K', figure: 'F', at: 0};
    assert.deepEqual(refused('summary', {rows: Array.from({length: 9}, () => row)}), at('rows'));
    const times = {a: 2, b: 1, tear: 3, verb: 4, result: 5, end: 6};
    const labels = {a: 'A', b: 'B', verb: 'V', result: 'R'};
    assert.deepEqual(refused('merge', {picture: pic, times, labels}), at('times'));
    const card = {word: 'W', gloss: 'g', icon: 'bruise', at: 0};
    assert.deepEqual(refused('cards', {picture: pic, cards: [card, card, card, card], times: {human: 1, end: 2}}), at('cards'));
    const step = {word: 'W', gloss: 'g'};
    assert.deepEqual(refused('stack', {picture: pic, steps: [step, step], labels: {weight: 'W'}, times: {w1: 0, w2: 1, w3: 2, stairs: 3, s1: 4, s2: 5, s3: 6, collapse: 7}}), at('steps'));
  });

  it('refuses a 16:9 lesson kit in a 9:16 timeline', () => {
    const doc = clone(fixture('vertical-short.json'));
    doc.tracks[0].items[0].kit = {name: 'chapter-opener', version: '1.0.0'};
    doc.tracks[0].items[0].props = {look: clone(DEMO_LOOK), kicker: 'CHAPTER I', title: 'THE CONTEXT'};
    assert.deepEqual(problems(doc), [['wrong-profile', '$.tracks[0].items[0].kit']]);
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
      ['block-title', '1.0.0', 'overlay'],
      ['brand-mark', '1.0.0', 'overlay'],
      ['brand-mark', '2.0.0', 'overlay'],
      ['captions', '1.0.0', 'fill'],
      ['captions', '1.1.0', 'overlay'],
      ['cards', '1.0.0', 'fill'],
      ['chapter-opener', '1.0.0', 'fill'],
      ['clip', '1.0.0', 'fill'],
      ['cover', '1.0.0', 'fill'],
      ['figure-title', '1.0.0', 'overlay'],
      ['interlinear', '1.0.0', 'overlay'],
      ['interprete', '1.0.0', 'fill'],
      ['interprete', '1.1.0', 'fill'],
      ['lower-third', '1.0.0', 'overlay'],
      ['merge', '1.0.0', 'fill'],
      ['monitor-wall', '1.0.0', 'fill'],
      ['museum-hall', '1.0.0', 'fill'],
      ['oxymoron', '1.0.0', 'fill'],
      ['panel', '1.0.0', 'fill'],
      ['panel', '1.1.0', 'fill'],
      ['progress', '1.0.0', 'overlay'],
      ['room', '1.0.0', 'fill'],
      ['room-effect', '1.0.0', 'fill'],
      ['simile', '1.0.0', 'fill'],
      ['stack', '1.0.0', 'fill'],
      ['still', '1.0.0', 'fill'],
      ['story-fx', '1.0.0', 'fill'],
      ['summary', '1.0.0', 'fill'],
      ['text-stack', '1.0.0', 'overlay'],
      ['timeline', '1.0.0', 'fill'],
      ['title-chip', '1.0.0', 'overlay'],
      ['verse-bar', '1.0.0', 'overlay'],
      ['verse-plate', '1.0.0', 'overlay'],
      ['warp', '1.0.0', 'fill'],
      ['word-tracks', '1.0.0', 'fill'],
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
