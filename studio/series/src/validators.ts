// The registered series validators, and the check that runs the one a
// template names. Like compilers, each released version is its own file and
// stays registered; its golden cases hold it to the findings it was released
// with.

import type { CheckResult, SeriesValidator, ValidateInput } from "./types.js";
import { releaseCode } from "./compile.js";
import { validator as poetryShort100 } from "./validators/poetry-short/1.0.0.js";
import { validator as dentroIVersiShort100 } from "./validators/dentro-i-versi-short/1.0.0.js";
import { validator as dentroIVersiLong100 } from "./validators/dentro-i-versi-long/1.0.0.js";

export const VALIDATORS: readonly SeriesValidator[] = Object.freeze([poetryShort100, dentroIVersiShort100, dentroIVersiLong100]);

/** The validator with exactly this id and version, or undefined. */
export function resolveValidator(id: string, version: string): SeriesValidator | undefined {
  return VALIDATORS.find((v) => v.id === id && v.version === version);
}

/** Every registered validator, sorted by id then version. */
export function listValidators(): { id: string; version: string; description: string }[] {
  return VALIDATORS.map(({ id, version, description }) => ({ id, version, description }))
    .sort((a, b) => a.id.localeCompare(b.id) || compareVersions(a.version, b.version));
}

/** Run the series rules the template names on the timeline about to be rendered. */
export function checkSeries(input: ValidateInput): CheckResult {
  const ref = input.template.validator;
  if (!ref) return { validator: null, findings: [] };
  const own = releaseCode(input, "validator");
  if (own && "problem" in own) {
    return { validator: `${ref.id}@${ref.version}`, findings: [{ ...own.problem, severity: "error" }] };
  }
  const validator = own ? own.code : resolveValidator(ref.id, ref.version);
  if (!validator) {
    const available = listValidators().filter((v) => v.id === ref.id).map((v) => `${v.id}@${v.version}`);
    return {
      validator: `${ref.id}@${ref.version}`,
      findings: [{
        code: "unknown-validator",
        severity: "error",
        path: "$.template.validator",
        message: `${ref.id}@${ref.version}: ${available.length > 0 ? `available ${available.join(", ")}` : "no validator with this id"}`,
      }],
    };
  }
  return { validator: `${validator.id}@${validator.version}`, findings: validator.validate(input) };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}
