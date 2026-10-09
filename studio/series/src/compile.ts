// Dispatch a spec to the compiler its template names, then hold the result
// to both timeline validators: the contracts' (structure, overlaps,
// references) and the composer's (kits and their props).

import { validateTimeline } from "@av/remotion-composer";
import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
import { listCompilers, resolveCompiler } from "./registry.js";
import type { CompileInput, CompileProblem, CompileResult, SeriesCompiler, SeriesValidator } from "./types.js";

/**
 * The release's own compiler or validator (avg-d1x), when its manifest names a
 * bundle: the loaded code, which must say the id and version the manifest
 * does. Null when the manifest names none, so the registry answers.
 */
export function releaseCode<K extends "compiler" | "validator">(
  input: CompileInput,
  role: K,
): { code: K extends "compiler" ? SeriesCompiler : SeriesValidator } | { problem: CompileProblem } | null {
  const ref = input.template[role] as { id: string; version: string; bundle?: { path: string } } | undefined;
  if (!ref?.bundle) return null;
  const code = input.code?.[role];
  if (!code) {
    return { problem: { code: "missing-code", path: `$.template.${role}.bundle`, message: `the release runs its own ${role} (${ref.bundle.path}), and it was not loaded` } };
  }
  if (code.id !== ref.id || code.version !== ref.version) {
    return { problem: { code: "code-mismatch", path: `$.template.${role}`, message: `${ref.bundle.path} is ${code.id}@${code.version}, not the ${ref.id}@${ref.version} the release names` } };
  }
  return { code: code as K extends "compiler" ? SeriesCompiler : SeriesValidator };
}

export function compileSpec(input: CompileInput): CompileResult {
  const { id, version } = input.template.compiler;
  const own = releaseCode(input, "compiler");
  if (own && "problem" in own) return { ok: false, problems: [own.problem] };
  const compiler = own ? own.code : resolveCompiler(id, version);
  if (!compiler) {
    const available = listCompilers().filter((c) => c.id === id).map((c) => `${c.id}@${c.version}`);
    return {
      ok: false,
      problems: [{
        code: "unknown-compiler",
        path: "$.template.compiler",
        message: `${id}@${version}: ${available.length > 0 ? `available ${available.join(", ")}` : "no compiler with this id"}`,
      }],
    };
  }

  const result = compiler.compile(input);
  if (!result.ok) return result;

  // A timeline the validators refuse is the compiler's fault, not the
  // episode's: the prefix says so.
  const problems: CompileProblem[] = validateEditTimeline(result.timeline)
    .map((p) => ({ code: `timeline:${p.code}`, message: p.message, path: p.path ?? "$" }));
  if (problems.length === 0) {
    const composer = validateTimeline(result.timeline, { kits: (input.kits ?? []).map((k) => k.kit) });
    if (!composer.ok) {
      problems.push(...composer.problems.map((p) => ({ code: `timeline:${p.code}`, message: p.message, path: p.path ?? "$" })));
    }
  }
  return problems.length > 0 ? { ok: false, problems } : result;
}
