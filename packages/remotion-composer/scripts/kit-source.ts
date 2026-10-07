// What a kit version draws with, and its lock hash (avg-tk7.3, ADR-0039).
//
// A kit version is its own file plus the frozen library modules it imports,
// transitively: src/kits/lib/<name>/<x.y.z>.ts(x). The lock hash covers all
// of them, so a released kit cannot change by an edit to a module it uses —
// a change to a released module is a new module version, and a new kit
// version to use it. A kit that imports no module hashes exactly as before:
// its file's sha256.

import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export const KITS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/kits');
const LIB = /^\.\.?\/(?:\.\.\/)?(?:lib\/)?([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/(\d+\.\d+\.\d+)\.js$/;
const FONT_FILE = /^@fontsource\/[a-z0-9-]+\/files\/[a-z0-9-]+\.woff2$/;

export interface ModuleRef {
  spec: string;
  typeOnly: boolean;
  /** import('…') or require('…'), as opposed to a declaration. */
  dynamic: boolean;
}

/** Every module a file reaches: import/export declarations, import = require(), import() and require(). */
export function importsOf(file: string): ModuleRef[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const refs: ModuleRef[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.every((e) => e.isTypeOnly)));
      refs.push({spec: node.moduleSpecifier.text, typeOnly, dynamic: false});
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({spec: node.moduleSpecifier.text, typeOnly: node.isTypeOnly, dynamic: false});
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      refs.push({spec: ts.isStringLiteral(expr) ? expr.text : '<computed>', typeOnly: node.isTypeOnly, dynamic: false});
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const arg = node.arguments[0];
      refs.push({spec: arg && ts.isStringLiteral(arg) ? arg.text : '<computed>', typeOnly: false, dynamic: true});
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

/** The file a library import names, from the importing file: ../lib/<name>/<v>.js (a kit) or ../<name>/<v>.js (a module). */
export function libraryFile(from: string, spec: string, kitsDir = KITS_DIR): string | null {
  const m = LIB.exec(spec);
  if (!m) return null;
  const base = path.resolve(path.dirname(from), spec.replace(/\.js$/, ''));
  if (!base.startsWith(path.join(kitsDir, 'lib') + path.sep)) return null;
  for (const ext of ['.tsx', '.ts']) if (existsSync(base + ext)) return base + ext;
  return null;
}

const isLibrary = (file: string, kitsDir: string) => file.startsWith(path.join(kitsDir, 'lib') + path.sep);

/** What a kit file or a library module may import; empty when it keeps the rules. */
export function moduleProblems(file: string, kitsDir = KITS_DIR): string[] {
  const library = isLibrary(file, kitsDir);
  const types = library ? '../../types.js' : '../types.js';
  const problems: string[] = [];
  for (const {spec, typeOnly, dynamic} of importsOf(file)) {
    if (['react', 'remotion', 'zod'].includes(spec)) continue;
    if (spec === types) {
      if (!typeOnly) problems.push(`imports values from ${types}: only types may come from there (use import type)`);
      continue;
    }
    if (LIB.test(spec)) {
      if (!libraryFile(file, spec, kitsDir)) problems.push(`imports ${spec}: no such library module (src/kits/lib/<name>/<x.y.z>.ts(x))`);
      continue;
    }
    if (library && dynamic && FONT_FILE.test(spec)) continue;
    problems.push(`imports ${spec}: only react, remotion, zod, types from ${types}, library modules${library ? ' and @fontsource font files (dynamic import)' : ''} are allowed`);
  }
  return problems;
}

/** The kit's file and every library module it reaches, sorted by path. */
export function sourceFiles(kitFile: string, kitsDir = KITS_DIR): string[] {
  const seen = new Set<string>([kitFile]);
  const queue = [kitFile];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const {spec, typeOnly} of importsOf(file)) {
      if (typeOnly) continue;
      const lib = libraryFile(file, spec, kitsDir);
      if (lib && !seen.has(lib)) {
        seen.add(lib);
        queue.push(lib);
      }
    }
  }
  return [...seen].sort();
}

/** The lock hash: the file's sha256 alone, or over every file it draws with (`<path>\0<bytes>` each, in path order). */
export function kitSourceHash(kitFile: string, kitsDir = KITS_DIR): string {
  const files = sourceFiles(kitFile, kitsDir);
  const hash = createHash('sha256');
  if (files.length === 1) hash.update(readFileSync(kitFile));
  else for (const file of files) hash.update(`${path.relative(kitsDir, file).split(path.sep).join('/')}\0`).update(readFileSync(file));
  return `sha256:${hash.digest('hex')}`;
}
