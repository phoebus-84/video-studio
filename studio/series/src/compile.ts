// Dispatch a spec to the compiler its template names, then hold the result
// to both timeline validators: the contracts' (structure, overlaps,
// references) and the composer's (kits and their props).

import { validateTimeline } from "@av/remotion-composer";
import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
import { listCompilers, resolveCompiler } from "./registry.js";
import type { CompileInput, CompileProblem, CompileResult } from "./types.js";

export function compileSpec(input: CompileInput): CompileResult {
  const { id, version } = input.template.compiler;
  const compiler = resolveCompiler(id, version);
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
    const composer = validateTimeline(result.timeline);
    if (!composer.ok) {
      problems.push(...composer.problems.map((p) => ({ code: `timeline:${p.code}`, message: p.message, path: p.path ?? "$" })));
    }
  }
  return problems.length > 0 ? { ok: false, problems } : result;
}
