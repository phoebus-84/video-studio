// Every kit version keeps the registry's rules (avg-tk7.3): well-formed
// metadata, examples its own schema accepts, self-contained source, a file
// frozen by kits.lock.json, and a committed preview.

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {KIT_VERSIONS} from '../src/kits/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (name: string, version: string) => path.join(root, 'src/kits', name, `${version}.tsx`);
const lock = JSON.parse(readFileSync(path.join(root, 'kits.lock.json'), 'utf8')) as Record<string, string>;
const ALLOWED_IMPORTS = new Set(['react', 'remotion', 'zod', '../types.js']);
/** The branch whose lock a change must keep: every entry there stays, unchanged. */
const LOCK_BASE = process.env.KITS_LOCK_BASE ?? 'origin/main';

/**
 * Every module a file reaches: import/export declarations, `import x =
 * require()`, dynamic `import()` and `require()`. `../types.js` may only be
 * reached for types, so nothing shared at runtime can change an old version.
 */
function moduleProblems(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const check = (spec: string, typeOnly: boolean) => {
    if (!ALLOWED_IMPORTS.has(spec)) problems.push(`imports ${spec}: only ${[...ALLOWED_IMPORTS].join(', ')} are allowed`);
    else if (spec === '../types.js' && !typeOnly) problems.push('imports values from ../types.js: only types may come from there (use import type)');
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.every((e) => e.isTypeOnly)));
      check(node.moduleSpecifier.text, typeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      check(node.moduleSpecifier.text, node.isTypeOnly);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      check(ts.isStringLiteral(expr) ? expr.text : '<computed>', node.isTypeOnly);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const arg = node.arguments[0];
      check(arg && ts.isStringLiteral(arg) ? arg.text : '<computed>', false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

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
        assert.deepEqual(moduleProblems(file), [], id);
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
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(path.join(root, 'src/kits', d.name)).filter((f) => f.endsWith('.tsx')).map((f) => `${d.name}@${f.replace(/\.tsx$/, '')}`));
    assert.deepEqual(files.filter((id) => !registered.has(id)), []);
  });
});
