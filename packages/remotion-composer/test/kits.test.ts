// Every kit version keeps the registry's rules (avg-tk7.3): well-formed
// metadata, examples its own schema accepts, self-contained source, a file
// frozen by kits.lock.json, and a committed preview in every output profile.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {KIT_VERSIONS, drawnFor, previewPath} from '../src/kits/index.js';
import {outputProfiles} from './helpers.js';
import {kitSourceHash, moduleProblems, sourceFiles} from '../scripts/kit-source.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (name: string, version: string) => path.join(root, 'src/kits', name, `${version}.tsx`);
const lock = JSON.parse(readFileSync(path.join(root, 'kits.lock.json'), 'utf8')) as Record<string, string>;
/** The branch whose lock a change must keep: every entry there stays, unchanged. */
const LOCK_BASE = process.env.KITS_LOCK_BASE ?? 'origin/main';

describe('kit versions', () => {
  for (const kit of KIT_VERSIONS) {
    const id = `${kit.name}@${kit.version}`;
    describe(id, () => {
      it('has a well-formed name, version and description', () => {
        assert.match(kit.name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
        assert.match(kit.version, /^\d+\.\d+\.\d+$/);
        assert.ok(kit.description.trim().length > 0);
      });

      it('has examples its own schema accepts, within their duration, with existing samples', () => {
        assert.ok(kit.examples.length > 0);
        assert.equal(new Set(kit.examples.map((e) => e.id)).size, kit.examples.length);
        for (const example of kit.examples) {
          assert.match(example.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
          const parsed = kit.props.safeParse(example.props);
          assert.ok(parsed.success, `${example.id}: ${parsed.success ? '' : parsed.error.message}`);
          assert.ok(Number.isInteger(example.durationInFrames) && example.durationInFrames >= 1);
          assert.ok(Number.isInteger(example.frame) && example.frame >= 0 && example.frame < example.durationInFrames);
          for (const file of Object.values(example.samples ?? {})) assert.ok(existsSync(path.join(root, 'kits/samples', file)), file);
        }
      });

      it('lives in its own file, sharing only frozen library modules', () => {
        const file = source(kit.name, kit.version);
        assert.ok(existsSync(file), `${path.relative(root, file)} must hold ${id}`);
        for (const f of sourceFiles(file)) assert.deepEqual(moduleProblems(f), [], path.relative(root, f));
      });

      it('is frozen by kits.lock.json, with the library modules it uses', () => {
        assert.ok(lock[id], `${id} is not in kits.lock.json: run npm run kits:lock`);
        assert.equal(kitSourceHash(source(kit.name, kit.version)), lock[id],
          `${id} is released: restore its file and the library modules it uses, and add ${kit.name}/<next version>.tsx (and new module versions) instead`);
      });

      it('has a committed preview in every output profile it is drawn for', () => {
        assert.ok(outputProfiles().some((p) => drawnFor(kit, p.id)), `${id} names no known output profile`);
        for (const profile of outputProfiles().filter((p) => drawnFor(kit, p.id))) {
          const file = previewPath(kit.name, kit.version, profile.id);
          assert.ok(existsSync(path.join(root, file)), `${file} is missing: run npm run kits:previews`);
        }
      });
    });
  }

  it('keeps no preview that no version and profile has', () => {
    const expected = new Set(KIT_VERSIONS.flatMap((k) => outputProfiles().filter((p) => drawnFor(k, p.id)).map((p) => path.basename(previewPath(k.name, k.version, p.id)))));
    assert.deepEqual(readdirSync(path.join(root, 'previews')).filter((f) => !expected.has(f)), []);
  });

  it('registers each version once', () => {
    const ids = KIT_VERSIONS.map((k) => `${k.name}@${k.version}`);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  });

  it(`keeps every version locked on ${LOCK_BASE}, unchanged`, (t) => {
    const base = spawnSync('git', ['show', `${LOCK_BASE}:packages/remotion-composer/kits.lock.json`], {cwd: root, encoding: 'utf8'});
    if (base.status !== 0) return t.skip(`no kits.lock.json on ${LOCK_BASE}`);
    const released = JSON.parse(base.stdout) as Record<string, string>;
    for (const [id, hash] of Object.entries(released)) {
      assert.equal(lock[id], hash, `${id} was released on ${LOCK_BASE}: its lock entry and file must not change or go away`);
    }
  });

  it('locks no version the registry does not have, and keeps no version file out of the registry', () => {
    const registered = new Set(KIT_VERSIONS.map((k) => `${k.name}@${k.version}`));
    assert.deepEqual(Object.keys(lock).filter((id) => !registered.has(id)), []);
    const files = readdirSync(path.join(root, 'src/kits'), {withFileTypes: true})
      .filter((d) => d.isDirectory() && d.name !== 'lib')
      .flatMap((d) => readdirSync(path.join(root, 'src/kits', d.name)).filter((f) => f.endsWith('.tsx')).map((f) => `${d.name}@${f.replace(/\.tsx$/, '')}`));
    assert.deepEqual(files.filter((id) => !registered.has(id)), []);
  });
});
