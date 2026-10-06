// Every kit version keeps the registry's rules (avg-tk7.3): well-formed
// metadata, examples its own schema accepts, self-contained source, a file
// frozen by kits.lock.json, and a committed preview.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KIT_VERSIONS} from '../src/kits/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (name: string, version: string) => path.join(root, 'src/kits', name, `${version}.tsx`);
const lock = JSON.parse(readFileSync(path.join(root, 'kits.lock.json'), 'utf8')) as Record<string, string>;
const ALLOWED_IMPORTS = new Set(['react', 'remotion', 'zod', '../types.js']);

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

      it('lives in its own self-contained file', () => {
        const file = source(kit.name, kit.version);
        assert.ok(existsSync(file), `${path.relative(root, file)} must hold ${id}`);
        const imports = [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
        for (const spec of imports) assert.ok(ALLOWED_IMPORTS.has(spec), `${id} imports ${spec}: only ${[...ALLOWED_IMPORTS].join(', ')} are allowed`);
      });

      it('is frozen by kits.lock.json', () => {
        const actual = `sha256:${createHash('sha256').update(readFileSync(source(kit.name, kit.version))).digest('hex')}`;
        assert.ok(lock[id], `${id} is not in kits.lock.json: run npm run kits:lock`);
        assert.equal(actual, lock[id], `${id} is released: restore its file and add ${kit.name}/<next version>.tsx instead`);
      });

      it('has a committed preview', () => {
        assert.ok(existsSync(path.join(root, 'previews', `${id}.png`)), `run npm run kits:previews`);
      });
    });
  }

  it('locks no version the registry does not have, and keeps no version file out of the registry', () => {
    const registered = new Set(KIT_VERSIONS.map((k) => `${k.name}@${k.version}`));
    assert.deepEqual(Object.keys(lock).filter((id) => !registered.has(id)), []);
    const files = readdirSync(path.join(root, 'src/kits'), {withFileTypes: true})
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(path.join(root, 'src/kits', d.name)).filter((f) => f.endsWith('.tsx')).map((f) => `${d.name}@${f.replace(/\.tsx$/, '')}`));
    assert.deepEqual(files.filter((id) => !registered.has(id)), []);
  });
});
