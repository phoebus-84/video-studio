// ---------------------------------------------------------------------------
// A series release's own code (avg-d1x)
// ---------------------------------------------------------------------------
// A template release may carry its compiler and validator as sealed,
// self-contained CommonJS bundles (`vpr template seal`). The loader runs the
// exact bytes whose hash it checked — never a second read of the file — and
// keeps one module per hash, so a release's code loads once per process.
// ---------------------------------------------------------------------------

import Module from "node:module";
import type { SeriesCompiler, SeriesValidator } from "@studio/series";

const loaded = new Map<string, Record<string, unknown>>();

/** The module of a bundle's bytes, its sha256 already checked by the caller. */
function moduleOf(file: string, bytes: Buffer, hash: string): Record<string, unknown> {
  const hit = loaded.get(hash);
  if (hit) return hit;
  const ModuleCtor = Module as unknown as new (id: string) => { filename: string; paths: string[]; exports: Record<string, unknown>; _compile(code: string, file: string): void };
  const m = new ModuleCtor(file);
  m.filename = file;
  m.paths = [];
  m._compile(bytes.toString("utf-8"), file);
  loaded.set(hash, m.exports);
  return m.exports;
}

/**
 * The compiler or validator a release's bundle exports (`export const
 * compiler` / `export const validator`), or why it is not one.
 */
export function releaseCodeOf<K extends "compiler" | "validator">(
  role: K,
  file: string,
  bytes: Buffer,
  hash: string,
): { ok: true; code: K extends "compiler" ? SeriesCompiler : SeriesValidator } | { ok: false; message: string } {
  let exports: Record<string, unknown>;
  try {
    exports = moduleOf(file, bytes, hash);
  } catch (error) {
    return { ok: false, message: `it does not load: ${(error as Error).message}` };
  }
  const code = exports[role] as Record<string, unknown> | undefined;
  const run = role === "compiler" ? "compile" : "validate";
  if (!code || typeof code.id !== "string" || typeof code.version !== "string" || typeof code[run] !== "function") {
    return { ok: false, message: `it does not export a ${role} (\`export const ${role}\` with id, version and ${run}())` };
  }
  return { ok: true, code: code as unknown as K extends "compiler" ? SeriesCompiler : SeriesValidator };
}
