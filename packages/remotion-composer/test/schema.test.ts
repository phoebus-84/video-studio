import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {EditTimelineSchema} from '../src/schema.js';
import {CONTRACT_FIXTURES, clone, fixture} from './helpers.js';

describe('the zod mirror of the v1alpha2 timeline', () => {
  it('accepts every valid fixture of the contracts', () => {
    const files = readdirSync(path.join(CONTRACT_FIXTURES, 'valid'));
    assert.ok(files.length >= 2);
    for (const file of files) {
      const result = EditTimelineSchema.safeParse(fixture(file));
      assert.ok(result.success, `${file}: ${result.success ? '' : result.error.message}`);
    }
  });

  it('rejects what the JSON Schema rejects', () => {
    const fractional = clone(fixture('lesson-excerpt.json'));
    fractional.tracks[2].items[0].from = 0.5;
    assert.equal(EditTimelineSchema.safeParse(fractional).success, false);

    const oldVersion = {...clone(fixture('lesson-excerpt.json')), apiVersion: 'studio.video/v1alpha1'};
    assert.equal(EditTimelineSchema.safeParse(oldVersion).success, false);

    const both = clone(fixture('lesson-excerpt.json'));
    both.tracks[1].items[0].asset = 'room';
    assert.equal(EditTimelineSchema.safeParse(both).success, false);

    const extra = {...clone(fixture('explainer.json')), unexpected: true};
    assert.equal(EditTimelineSchema.safeParse(extra).success, false);
  });
});
